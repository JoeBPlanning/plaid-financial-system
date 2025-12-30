const { getDatabase } = require('../database-supabase');

class MonthlySummary {
  static async find(query = {}) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('monthly_summaries').select('*');

    // Apply filters
    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    // Order by date descending
    dbQuery = dbQuery.order('date', { ascending: false });

    const { data, error } = await dbQuery;

    if (error) throw error;

    return data.map(row => this._mapToModel(row));
  }

  static async findOne(query) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('monthly_summaries').select('*');

    // Apply filters
    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    const { data, error } = await dbQuery.limit(1).single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return this._mapToModel(data);
  }

  static async findOneAndUpdate(query, update, options = {}) {
    const existing = await this.findOne(query);

    if (!existing && !options.upsert) {
      return null;
    }

    if (!existing && options.upsert) {
      return this.create({ ...query, ...update });
    }

    return this.update(existing.id, update);
  }

  static async create(data) {
    const supabase = getDatabase();

    const { error, data: created } = await supabase
      .from('monthly_summaries')
      .insert([{
        client_id: data.clientId,
        month_year: data.monthYear,
        date: data.date instanceof Date ? data.date.toISOString() : data.date,
        year: data.year,
        cash_flow: data.cashFlow || {},
        net_worth: data.netWorth || {},
        client_profile: data.clientProfile || {},
        transactions_processed: data.transactionsProcessed || 0,
        last_processed_at: data.lastProcessedAt
          ? (data.lastProcessedAt instanceof Date ? data.lastProcessedAt.toISOString() : data.lastProcessedAt)
          : new Date().toISOString(),
        review_status: data.reviewStatus || 'pending'
      }])
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(created);
  }

  static async update(id, data) {
    const supabase = getDatabase();

    const { error, data: updated } = await supabase
      .from('monthly_summaries')
      .update({
        cash_flow: data.cashFlow || {},
        net_worth: data.netWorth || {},
        client_profile: data.clientProfile || {},
        transactions_processed: data.transactionsProcessed || 0,
        last_processed_at: data.lastProcessedAt
          ? (data.lastProcessedAt instanceof Date ? data.lastProcessedAt.toISOString() : data.lastProcessedAt)
          : new Date().toISOString(),
        review_status: data.reviewStatus || 'pending'
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(updated);
  }

  static _mapToModel(row) {
    if (!row) return null;

    return {
      _id: row.id,
      id: row.id,
      clientId: row.client_id,
      monthYear: row.month_year,
      date: new Date(row.date),
      year: row.year,
      cashFlow: row.cash_flow,
      netWorth: row.net_worth,
      clientProfile: row.client_profile,
      transactionsProcessed: row.transactions_processed,
      lastProcessedAt: row.last_processed_at ? new Date(row.last_processed_at) : null,
      reviewStatus: row.review_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  static _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

module.exports = MonthlySummary;
