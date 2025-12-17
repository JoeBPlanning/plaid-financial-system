const { getDatabase } = require('../database');

class MonthlySummary {
  static find(query = {}) {
    const db = getDatabase();
    let sql = 'SELECT * FROM monthly_summaries';
    const conditions = [];
    const params = [];

    if (Object.keys(query).length > 0) {
      Object.keys(query).forEach(key => {
        conditions.push(`${key} = ?`);
        params.push(query[key]);
      });
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date DESC';
    
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

    const sql = 'SELECT * FROM monthly_summaries WHERE ' + conditions.join(' AND ') + ' LIMIT 1';
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

    return this.update(existing.id, update);
  }

  static async create(data) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO monthly_summaries 
      (clientId, monthYear, date, year, cashFlow, netWorth, clientProfile, 
       transactionsProcessed, lastProcessedAt, reviewStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      data.clientId,
      data.monthYear,
      data.date instanceof Date ? data.date.toISOString() : data.date,
      data.year,
      JSON.stringify(data.cashFlow || {}),
      JSON.stringify(data.netWorth || {}),
      JSON.stringify(data.clientProfile || {}),
      data.transactionsProcessed || 0,
      data.lastProcessedAt ? (data.lastProcessedAt instanceof Date ? data.lastProcessedAt.toISOString() : data.lastProcessedAt) : new Date().toISOString(),
      data.reviewStatus || 'pending'
    );

    return this.findOne({ clientId: data.clientId, monthYear: data.monthYear });
  }

  static update(id, data) {
    const db = getDatabase();
    const update = db.prepare(`
      UPDATE monthly_summaries 
      SET cashFlow = ?, netWorth = ?, clientProfile = ?, 
          transactionsProcessed = ?, lastProcessedAt = ?, reviewStatus = ?,
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    update.run(
      JSON.stringify(data.cashFlow || {}),
      JSON.stringify(data.netWorth || {}),
      JSON.stringify(data.clientProfile || {}),
      data.transactionsProcessed || 0,
      data.lastProcessedAt ? (data.lastProcessedAt instanceof Date ? data.lastProcessedAt.toISOString() : data.lastProcessedAt) : new Date().toISOString(),
      data.reviewStatus || 'pending',
      id
    );

    return this.findOne({ id });
  }

  static _mapRow(row) {
    return {
      _id: row.id,
      id: row.id,
      clientId: row.clientId,
      monthYear: row.monthYear,
      date: new Date(row.date),
      year: row.year,
      cashFlow: JSON.parse(row.cashFlow || '{}'),
      netWorth: JSON.parse(row.netWorth || '{}'),
      clientProfile: JSON.parse(row.clientProfile || '{}'),
      transactionsProcessed: row.transactionsProcessed,
      lastProcessedAt: row.lastProcessedAt ? new Date(row.lastProcessedAt) : null,
      reviewStatus: row.reviewStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}

module.exports = MonthlySummary;

