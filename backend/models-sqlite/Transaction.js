const { getDatabase } = require('../database');

class Transaction {
  static find(query = {}, options = {}) {
    const db = getDatabase();
    let sql = 'SELECT * FROM transactions';
    const conditions = [];
    const params = [];

    if (Object.keys(query).length > 0) {
      Object.keys(query).forEach(key => {
        if (key === 'monthYear' && query[key].$in) {
          conditions.push(`monthYear IN (${query[key].$in.map(() => '?').join(',')})`);
          params.push(...query[key].$in);
        } else if (typeof query[key] === 'object' && query[key] !== null && query[key].$gte) {
          const value = query[key].$gte instanceof Date ? query[key].$gte.toISOString() : query[key].$gte;
          conditions.push(`${key} >= ?`);
          params.push(value);
        } else if (typeof query[key] === 'object' && query[key] !== null && query[key].$lte) {
          const value = query[key].$lte instanceof Date ? query[key].$lte.toISOString() : query[key].$lte;
          conditions.push(`${key} <= ?`);
          params.push(value);
        } else {
          conditions.push(`${key} = ?`);
          params.push(query[key]);
        }
      });
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date DESC';
    
    // Add limit if specified
    if (options.limit) {
      sql += ` LIMIT ${parseInt(options.limit)}`;
    }
    
    const stmt = db.prepare(sql);
    const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
    
    return rows.map(row => this._mapRow(row));
  }

  static findOne(query) {
    const db = getDatabase();
    const conditions = [];
    const params = [];

    // Handle $or queries
    if (query.$or) {
      const orConditions = [];
      query.$or.forEach(orQuery => {
        const keys = Object.keys(orQuery);
        const conditionParts = keys.map(k => {
          // Convert MongoDB-style _id to plaidTransactionId
          // (since _id in the mapped object represents plaidTransactionId)
          if (k === '_id') {
            return 'plaidTransactionId = ?';
          }
          return `${k} = ?`;
        });
        orConditions.push('(' + conditionParts.join(' AND ') + ')');
        // Push values in the same order as the conditions
        keys.forEach(key => {
          params.push(orQuery[key]);
        });
      });
      conditions.push('(' + orConditions.join(' OR ') + ')');
    } else {
      Object.keys(query).forEach(key => {
        if (key !== 'clientId') {
          // Convert MongoDB-style _id to plaidTransactionId
          // (since _id in the mapped object represents plaidTransactionId)
          if (key === '_id') {
            conditions.push('plaidTransactionId = ?');
          } else {
            conditions.push(`${key} = ?`);
          }
          params.push(query[key]);
        }
      });
    }

    if (query.clientId) {
      conditions.push('clientId = ?');
      params.push(query.clientId);
    }

    const sql = 'SELECT * FROM transactions WHERE ' + conditions.join(' AND ') + ' LIMIT 1';
    const stmt = db.prepare(sql);
    const row = stmt.get(...params);
    
    return row ? this._mapRow(row) : null;
  }

  static findOneAndUpdate(query, update, options = {}) {
    const existing = this.findOne(query);
    if (!existing && !options.upsert) {
      return null;
    }

    if (!existing && options.upsert) {
      return this.create({ ...query, ...update });
    }

    // Ensure we update the correct record - use id from the found record
    if (existing && existing.id) {
      return this.update(existing.id, update);
    }
    
    // Fallback: try to find by plaidTransactionId if id is not available
    if (existing && existing.plaidTransactionId) {
      const db = getDatabase();
      const updateStmt = db.prepare(`
        UPDATE transactions 
        SET userCategory = ?, isReviewed = ?, notes = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE plaidTransactionId = ? AND clientId = ?
      `);
      
      updateStmt.run(
        update.userCategory || null,
        update.isReviewed !== undefined ? (update.isReviewed ? 1 : 0) : null,
        update.notes || null,
        existing.plaidTransactionId,
        query.clientId || existing.clientId
      );
      
      return this.findOne({ plaidTransactionId: existing.plaidTransactionId });
    }
    
    return null;
  }

  static async create(data) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO transactions 
      (clientId, plaidTransactionId, accountId, accountType, accountSubtype, accountName, accountMask, amount, date, name, merchantName, 
       category, plaidCategory, plaidSubCategory, personalFinanceCategory, 
       suggestedCategory, userCategory, isReviewed, monthYear, notes, institution)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      data.clientId,
      data.plaidTransactionId || data._id,
      data.accountId,
      data.accountType || null,
      data.accountSubtype || null,
      data.accountName || null,
      data.accountMask || null,
      data.amount,
      data.date instanceof Date ? data.date.toISOString() : data.date,
      data.name,
      data.merchantName || null,
      JSON.stringify(data.category || []),
      data.plaidCategory || null,
      data.plaidSubCategory || null,
      JSON.stringify(data.personalFinanceCategory || null),
      data.suggestedCategory,
      data.userCategory || null,
      data.isReviewed ? 1 : 0,
      data.monthYear,
      data.notes || null,
      data.institution || null
    );

    return this.findOne({ plaidTransactionId: data.plaidTransactionId || data._id });
  }

  static update(id, data) {
    const db = getDatabase();
    const update = db.prepare(`
      UPDATE transactions 
      SET userCategory = ?, isReviewed = ?, notes = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    update.run(
      data.userCategory || null,
      data.isReviewed !== undefined ? (data.isReviewed ? 1 : 0) : null,
      data.notes || null,
      id
    );

    return this.findOne({ id });
  }

  static deleteMany(query) {
    const db = getDatabase();
    const conditions = [];
    const params = [];

    Object.keys(query).forEach(key => {
      conditions.push(`${key} = ?`);
      params.push(query[key]);
    });

    const sql = 'DELETE FROM transactions WHERE ' + conditions.join(' AND ');
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  }

  static _mapRow(row) {
    return {
      _id: row.plaidTransactionId,
      id: row.id,
      clientId: row.clientId,
      plaidTransactionId: row.plaidTransactionId,
      accountId: row.accountId,
      accountType: row.accountType,
      accountSubtype: row.accountSubtype,
      accountName: row.accountName,
      accountMask: row.accountMask,
      amount: row.amount,
      date: new Date(row.date),
      name: row.name,
      merchantName: row.merchantName,
      category: JSON.parse(row.category || '[]'),
      plaidCategory: row.plaidCategory,
      plaidSubCategory: row.plaidSubCategory,
      personalFinanceCategory: row.personalFinanceCategory ? JSON.parse(row.personalFinanceCategory) : null,
      suggestedCategory: row.suggestedCategory,
      userCategory: row.userCategory,
      isReviewed: row.isReviewed === 1,
      monthYear: row.monthYear,
      notes: row.notes,
      institution: row.institution,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}

module.exports = Transaction;

