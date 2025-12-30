const { getDatabase } = require('../database-supabase');

class Investment {
  static async find(query = {}) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('investments').select('*');

    // Apply filters
    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    const { data, error } = await dbQuery;

    if (error) throw error;

    return data.map(row => this._mapToModel(row));
  }

  static async findOne(query) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('investments').select('*');

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
      .from('investments')
      .insert([{
        client_id: data.clientId,
        account_id: data.accountId,
        account_name: data.accountName,
        account_type: data.accountType,
        account_subtype: data.accountSubtype,
        security_id: data.securityId,
        security_name: data.securityName,
        security_ticker: data.securityTicker,
        security_type: data.securityType,
        quantity: data.quantity || 0,
        price: data.price || 0,
        value: data.value || 0,
        cost_basis: data.costBasis || 0,
        institution_name: data.institutionName,
        institution_id: data.institutionId,
        item_id: data.itemId,
        account_tax_type: data.accountTaxType,
        last_updated: data.lastUpdated ? (data.lastUpdated instanceof Date ? data.lastUpdated.toISOString() : data.lastUpdated) : null
      }])
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(created);
  }

  static async upsert(data) {
    const supabase = getDatabase();

    const { error, data: upserted } = await supabase
      .from('investments')
      .upsert([{
        client_id: data.clientId,
        account_id: data.accountId,
        account_name: data.accountName,
        account_type: data.accountType,
        account_subtype: data.accountSubtype,
        security_id: data.securityId,
        security_name: data.securityName,
        security_ticker: data.securityTicker,
        security_type: data.securityType,
        quantity: data.quantity || 0,
        price: data.price || 0,
        value: data.value || 0,
        cost_basis: data.costBasis || 0,
        institution_name: data.institutionName,
        institution_id: data.institutionId,
        item_id: data.itemId,
        account_tax_type: data.accountTaxType,
        last_updated: data.lastUpdated ? (data.lastUpdated instanceof Date ? data.lastUpdated.toISOString() : data.lastUpdated) : null
      }], {
        onConflict: 'client_id,account_id,security_id'
      })
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(upserted);
  }

  static async deleteMany(query) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('investments').delete();

    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    const { error, count } = await dbQuery;

    if (error) throw error;

    return { deletedCount: count };
  }

  static _mapToModel(row) {
    if (!row) return null;

    return {
      id: row.id,
      clientId: row.client_id,
      accountId: row.account_id,
      accountName: row.account_name,
      accountType: row.account_type,
      accountSubtype: row.account_subtype,
      securityId: row.security_id,
      securityName: row.security_name,
      securityTicker: row.security_ticker,
      securityType: row.security_type,
      quantity: parseFloat(row.quantity),
      price: parseFloat(row.price),
      value: parseFloat(row.value),
      costBasis: parseFloat(row.cost_basis),
      institutionName: row.institution_name,
      institutionId: row.institution_id,
      itemId: row.item_id,
      accountTaxType: row.account_tax_type,
      lastUpdated: row.last_updated ? new Date(row.last_updated) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  static _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

module.exports = Investment;
