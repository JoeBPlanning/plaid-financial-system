const { getDatabase } = require('../database-supabase');

class InvestmentSnapshot {
  static async find(query = {}) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('investment_snapshots').select('*');

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

    let dbQuery = supabase.from('investment_snapshots').select('*');

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
      .from('investment_snapshots')
      .insert([{
        client_id: data.clientId,
        snapshot_date: data.snapshotDate instanceof Date ? data.snapshotDate.toISOString().split('T')[0] : data.snapshotDate,
        month_year: data.monthYear,
        total_value: data.totalValue || 0,
        total_by_tax_type: data.totalByTaxType || {},
        holdings_by_account: data.holdingsByAccount || {},
        asset_class_breakdown: data.assetClassBreakdown || {}
      }])
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(created);
  }

  static async upsert(data) {
    const supabase = getDatabase();

    const { error, data: upserted } = await supabase
      .from('investment_snapshots')
      .upsert([{
        client_id: data.clientId,
        snapshot_date: data.snapshotDate instanceof Date ? data.snapshotDate.toISOString().split('T')[0] : data.snapshotDate,
        month_year: data.monthYear,
        total_value: data.totalValue || 0,
        total_by_tax_type: data.totalByTaxType || {},
        holdings_by_account: data.holdingsByAccount || {},
        asset_class_breakdown: data.assetClassBreakdown || {}
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
      totalValue: parseFloat(row.total_value),
      totalByTaxType: row.total_by_tax_type,
      holdingsByAccount: row.holdings_by_account,
      assetClassBreakdown: row.asset_class_breakdown,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  static _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

module.exports = InvestmentSnapshot;
