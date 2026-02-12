const { getDatabase } = require('../database');

const VALID_COLUMNS = new Set([
  'id', 'clientId', 'accountId', 'accountName', 'accountType', 'accountSubtype',
  'securityId', 'securityName', 'securityTicker', 'securityType',
  'quantity', 'price', 'value', 'costBasis',
  'institutionName', 'institutionId', 'itemId', 'accountTaxType',
  'lastUpdated', 'createdAt', 'updatedAt'
]);

function validateColumn(col) {
  if (!VALID_COLUMNS.has(col)) {
    throw new Error(`Invalid column name: ${col}`);
  }
  return col;
}

class Investment {
  static find(query = {}, options = {}) {
    const db = getDatabase();
    let sql = 'SELECT * FROM investments';
    const conditions = [];
    const params = [];

    if (Object.keys(query).length > 0) {
      Object.keys(query).forEach(key => {
        if (key === 'clientId') {
          conditions.push(`clientId = ?`);
          params.push(query[key]);
        } else if (key === 'accountId') {
          conditions.push(`accountId = ?`);
          params.push(query[key]);
        } else if (key === 'securityId') {
          conditions.push(`securityId = ?`);
          params.push(query[key]);
        }
      });
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY value DESC';
    
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

    Object.keys(query).forEach(key => {
      conditions.push(`${validateColumn(key)} = ?`);
      params.push(query[key]);
    });

    const sql = `SELECT * FROM investments WHERE ${conditions.join(' AND ')} LIMIT 1`;
    const stmt = db.prepare(sql);
    const row = stmt.get(...params);
    
    return row ? this._mapRow(row) : null;
  }

  static create(data) {
    const db = getDatabase();
    const sql = `
      INSERT INTO investments (
        clientId, accountId, accountName, accountType, accountSubtype,
        securityId, securityName, securityTicker, securityType,
        quantity, price, value, costBasis,
        institutionName, institutionId, itemId,
        accountTaxType, -- tax-free, tax-deferred, taxable
        lastUpdated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const stmt = db.prepare(sql);
    const result = stmt.run(
      data.clientId,
      data.accountId,
      data.accountName || null,
      data.accountType || null,
      data.accountSubtype || null,
      data.securityId,
      data.securityName || null,
      data.securityTicker || null,
      data.securityType || null,
      data.quantity || 0,
      data.price || 0,
      data.value || 0,
      data.costBasis || 0,
      data.institutionName || null,
      data.institutionId || null,
      data.itemId || null,
      data.accountTaxType || null,
      new Date().toISOString()
    );
    
    return this.findOne({ id: result.lastInsertRowid });
  }

  static findOneAndUpdate(query, update) {
    const db = getDatabase();
    const existing = this.findOne(query);
    
    if (!existing) {
      return null;
    }
    
    const fields = [];
    const values = [];
    
    Object.keys(update).forEach(key => {
      if (key !== 'id' && key !== '_id') {
        fields.push(`${validateColumn(key)} = ?`);
        values.push(update[key]);
      }
    });

    // Add lastUpdated timestamp, then id for WHERE clause
    values.push(new Date().toISOString());
    values.push(existing.id);
    
    const sql = `UPDATE investments SET ${fields.join(', ')}, lastUpdated = ? WHERE id = ?`;
    const stmt = db.prepare(sql);
    stmt.run(...values);
    
    return this.findOne({ id: existing.id });
  }

  static deleteMany(query) {
    const db = getDatabase();
    const conditions = [];
    const params = [];

    Object.keys(query).forEach(key => {
      conditions.push(`${validateColumn(key)} = ?`);
      params.push(query[key]);
    });

    const sql = `DELETE FROM investments WHERE ${conditions.join(' AND ')}`;
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  }

  static _mapRow(row) {
    return {
      _id: row.id,
      id: row.id,
      clientId: row.clientId,
      accountId: row.accountId,
      accountName: row.accountName,
      accountType: row.accountType,
      accountSubtype: row.accountSubtype,
      securityId: row.securityId,
      securityName: row.securityName,
      securityTicker: row.securityTicker,
      securityType: row.securityType,
      quantity: row.quantity,
      price: row.price,
      value: row.value,
      costBasis: row.costBasis,
      institutionName: row.institutionName,
      institutionId: row.institutionId,
      itemId: row.itemId,
      accountTaxType: row.accountTaxType,
      lastUpdated: row.lastUpdated,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}

module.exports = Investment;

