const { getDatabase } = require('../database-supabase');

class BalanceSheet {
  static async find(query = {}) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('balance_sheets').select('*');

    // Apply filters
    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    dbQuery = dbQuery.order('snapshot_date', { ascending: false });

    const { data, error } = await dbQuery;

    if (error) throw error;

    return data.map(row => this._mapToModel(row));
  }

  static async findOne(query) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('balance_sheets').select('*');

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

  static async create(data) {
    const supabase = getDatabase();

    const { error, data: created } = await supabase
      .from('balance_sheets')
      .insert([{
        client_id: data.clientId,
        snapshot_date: data.snapshotDate instanceof Date ? data.snapshotDate.toISOString().split('T')[0] : data.snapshotDate,
        month_year: data.monthYear,
        assets: data.assets || 0,
        liabilities: data.liabilities || 0,
        net_worth: data.netWorth || 0,
        asset_breakdown: data.assetBreakdown || {},
        liability_breakdown: data.liabilityBreakdown || {}
      }])
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(created);
  }

  static async upsert(data) {
    const supabase = getDatabase();

    const { error, data: upserted } = await supabase
      .from('balance_sheets')
      .upsert([{
        client_id: data.clientId,
        snapshot_date: data.snapshotDate instanceof Date ? data.snapshotDate.toISOString().split('T')[0] : data.snapshotDate,
        month_year: data.monthYear,
        assets: data.assets || 0,
        liabilities: data.liabilities || 0,
        net_worth: data.netWorth || 0,
        asset_breakdown: data.assetBreakdown || {},
        liability_breakdown: data.liabilityBreakdown || {}
      }], {
        onConflict: 'client_id,snapshot_date'
      })
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(upserted);
  }

  static _mapToModel(row) {
    if (!row) return null;

    return {
      id: row.id,
      clientId: row.client_id,
      snapshotDate: new Date(row.snapshot_date),
      monthYear: row.month_year,
      assets: parseFloat(row.assets),
      liabilities: parseFloat(row.liabilities),
      netWorth: parseFloat(row.net_worth),
      assetBreakdown: row.asset_breakdown,
      liabilityBreakdown: row.liability_breakdown,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  static _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

module.exports = BalanceSheet;
