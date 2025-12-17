const { getDatabase } = require('../database');

class InvestmentSnapshot {
  static find(query = {}, options = {}) {
    const db = getDatabase();
    let sql = 'SELECT * FROM investment_snapshots';
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

    const sql = `SELECT * FROM investment_snapshots WHERE ${conditions.join(' AND ')} LIMIT 1`;
    const stmt = db.prepare(sql);
    const row = stmt.get(...params);
    
    return row ? this._mapRow(row) : null;
  }

  static create(data) {
    const db = getDatabase();
    const sql = `
      INSERT INTO investment_snapshots (
        clientId, snapshotDate, monthYear,
        totalValue, totalByTaxType, holdingsByAccount,
        assetClassBreakdown, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const stmt = db.prepare(sql);
    const result = stmt.run(
      data.clientId,
      data.snapshotDate,
      data.monthYear || null,
      data.totalValue || 0,
      JSON.stringify(data.totalByTaxType || {}),
      JSON.stringify(data.holdingsByAccount || []),
      JSON.stringify(data.assetClassBreakdown || {}),
      new Date().toISOString()
    );
    
    return this.findOne({ id: result.lastInsertRowid });
  }

  static _mapRow(row) {
    return {
      _id: row.id,
      id: row.id,
      clientId: row.clientId,
      snapshotDate: row.snapshotDate,
      monthYear: row.monthYear,
      totalValue: row.totalValue,
      totalByTaxType: row.totalByTaxType ? JSON.parse(row.totalByTaxType) : {},
      holdingsByAccount: row.holdingsByAccount ? JSON.parse(row.holdingsByAccount) : [],
      assetClassBreakdown: row.assetClassBreakdown ? JSON.parse(row.assetClassBreakdown) : {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}

module.exports = InvestmentSnapshot;

