const { getDatabase } = require('../database');

class BalanceSheet {
  static find(query = {}, options = {}) {
    const db = getDatabase();
    let sql = 'SELECT * FROM balance_sheets';
    const conditions = [];
    const params = [];

    if (Object.keys(query).length > 0) {
      Object.keys(query).forEach(key => {
        if (key === 'clientId') {
          conditions.push(`clientId = ?`);
          params.push(query[key]);
        } else if (key === 'snapshotDate') {
          if (typeof query[key] === 'object' && query[key].$gte) {
            conditions.push(`snapshotDate >= ?`);
            params.push(query[key].$gte);
          } else if (typeof query[key] === 'object' && query[key].$lte) {
            conditions.push(`snapshotDate <= ?`);
            params.push(query[key].$lte);
          } else {
            conditions.push(`snapshotDate = ?`);
            params.push(query[key]);
          }
        } else if (key === 'monthYear') {
          conditions.push(`monthYear = ?`);
          params.push(query[key]);
        }
      });
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY snapshotDate DESC';
    
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
      conditions.push(`${key} = ?`);
      params.push(query[key]);
    });

    const sql = `SELECT * FROM balance_sheets WHERE ${conditions.join(' AND ')} LIMIT 1`;
    const stmt = db.prepare(sql);
    const row = stmt.get(...params);
    
    return row ? this._mapRow(row) : null;
  }

  static create(data) {
    const db = getDatabase();
    const sql = `
      INSERT INTO balance_sheets (
        clientId, snapshotDate, monthYear,
        assets, liabilities, netWorth,
        assetBreakdown, liabilityBreakdown,
        createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const stmt = db.prepare(sql);
    const result = stmt.run(
      data.clientId,
      data.snapshotDate,
      data.monthYear || null,
      data.assets || 0,
      data.liabilities || 0,
      data.netWorth || 0,
      JSON.stringify(data.assetBreakdown || {}),
      JSON.stringify(data.liabilityBreakdown || {}),
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
        if (key === 'assetBreakdown' || key === 'liabilityBreakdown') {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(update[key]));
        } else {
          fields.push(`${key} = ?`);
          values.push(update[key]);
        }
      }
    });
    
    values.push(existing.id);
    
    const sql = `UPDATE balance_sheets SET ${fields.join(', ')}, updatedAt = ? WHERE id = ?`;
    const stmt = db.prepare(sql);
    stmt.run(...values, new Date().toISOString());
    
    return this.findOne({ id: existing.id });
  }

  static deleteMany(query) {
    const db = getDatabase();
    const conditions = [];
    const params = [];

    Object.keys(query).forEach(key => {
      conditions.push(`${key} = ?`);
      params.push(query[key]);
    });

    const sql = `DELETE FROM balance_sheets WHERE ${conditions.join(' AND ')}`;
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  }

  static _mapRow(row) {
    return {
      _id: row.id,
      id: row.id,
      clientId: row.clientId,
      snapshotDate: row.snapshotDate,
      monthYear: row.monthYear,
      assets: row.assets,
      liabilities: row.liabilities,
      netWorth: row.netWorth,
      assetBreakdown: row.assetBreakdown ? JSON.parse(row.assetBreakdown) : {},
      liabilityBreakdown: row.liabilityBreakdown ? JSON.parse(row.liabilityBreakdown) : {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}

module.exports = BalanceSheet;

