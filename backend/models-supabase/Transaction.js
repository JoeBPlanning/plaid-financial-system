const { getDatabase } = require('../database-supabase');

class Transaction {
  static async find(query = {}, options = {}) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('transactions').select('*');

    // Apply filters
    Object.keys(query).forEach(key => {
      if (key === 'monthYear' && query[key].$in) {
        dbQuery = dbQuery.in('month_year', query[key].$in);
      } else if (typeof query[key] === 'object' && query[key] !== null && query[key].$gte) {
        const value = query[key].$gte instanceof Date ? query[key].$gte.toISOString() : query[key].$gte;
        dbQuery = dbQuery.gte('date', value);
      } else if (typeof query[key] === 'object' && query[key] !== null && query[key].$lte) {
        const value = query[key].$lte instanceof Date ? query[key].$lte.toISOString() : query[key].$lte;
        dbQuery = dbQuery.lte('date', value);
      } else {
        const dbKey = this._toSnakeCase(key);
        dbQuery = dbQuery.eq(dbKey, query[key]);
      }
    });

    // Order by date descending
    dbQuery = dbQuery.order('date', { ascending: false });

    // Apply limit if specified
    if (options.limit) {
      dbQuery = dbQuery.limit(parseInt(options.limit));
    }

    const { data, error } = await dbQuery;

    if (error) throw error;

    return data.map(row => this._mapToModel(row));
  }

  static async findOne(query) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('transactions').select('*');

    // Handle $or queries
    if (query.$or) {
      // Supabase doesn't support OR directly in the JS client easily
      // We'll fetch all matching records and filter in memory
      // For better performance, consider restructuring queries or using RPC functions
      const orConditions = query.$or;
      const promises = orConditions.map(async orQuery => {
        let subQuery = supabase.from('transactions').select('*');
        Object.keys(orQuery).forEach(key => {
          const dbKey = key === '_id' ? 'plaid_transaction_id' : this._toSnakeCase(key);
          subQuery = subQuery.eq(dbKey, orQuery[key]);
        });
        if (query.clientId) {
          subQuery = subQuery.eq('client_id', query.clientId);
        }
        const { data } = await subQuery.limit(1);
        return data && data.length > 0 ? data[0] : null;
      });

      const results = await Promise.all(promises);
      const found = results.find(r => r !== null);
      return found ? this._mapToModel(found) : null;
    }

    // Regular query
    Object.keys(query).forEach(key => {
      if (key === '_id') {
        dbQuery = dbQuery.eq('plaid_transaction_id', query[key]);
      } else {
        const dbKey = this._toSnakeCase(key);
        dbQuery = dbQuery.eq(dbKey, query[key]);
      }
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

    // Update using plaidTransactionId and clientId
    const supabase = getDatabase();

    const { data, error } = await supabase
      .from('transactions')
      .update({
        user_category: update.userCategory || null,
        is_reviewed: update.isReviewed !== undefined ? update.isReviewed : null,
        notes: update.notes || null
      })
      .eq('plaid_transaction_id', existing.plaidTransactionId)
      .eq('client_id', existing.clientId)
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(data);
  }

  static async create(data) {
    const supabase = getDatabase();

    const { error, data: created } = await supabase
      .from('transactions')
      .insert([{
        client_id: data.clientId,
        plaid_transaction_id: data.plaidTransactionId || data._id,
        account_id: data.accountId,
        account_type: data.accountType || null,
        account_subtype: data.accountSubtype || null,
        account_name: data.accountName || null,
        account_mask: data.accountMask || null,
        amount: data.amount,
        date: data.date instanceof Date ? data.date.toISOString() : data.date,
        name: data.name,
        merchant_name: data.merchantName || null,
        category: data.category || [],
        plaid_category: data.plaidCategory || null,
        plaid_sub_category: data.plaidSubCategory || null,
        personal_finance_category: data.personalFinanceCategory || null,
        suggested_category: data.suggestedCategory,
        user_category: data.userCategory || null,
        is_reviewed: data.isReviewed || false,
        month_year: data.monthYear,
        notes: data.notes || null,
        institution: data.institution || null
      }])
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(created);
  }

  static async update(id, data) {
    const supabase = getDatabase();

    const { error, data: updated } = await supabase
      .from('transactions')
      .update({
        user_category: data.userCategory || null,
        is_reviewed: data.isReviewed !== undefined ? data.isReviewed : null,
        notes: data.notes || null
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(updated);
  }

  static async deleteMany(query) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('transactions').delete();

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
      _id: row.plaid_transaction_id,
      id: row.id,
      clientId: row.client_id,
      plaidTransactionId: row.plaid_transaction_id,
      accountId: row.account_id,
      accountType: row.account_type,
      accountSubtype: row.account_subtype,
      accountName: row.account_name,
      accountMask: row.account_mask,
      amount: parseFloat(row.amount),
      date: new Date(row.date),
      name: row.name,
      merchantName: row.merchant_name,
      category: row.category,
      plaidCategory: row.plaid_category,
      plaidSubCategory: row.plaid_sub_category,
      personalFinanceCategory: row.personal_finance_category,
      suggestedCategory: row.suggested_category,
      userCategory: row.user_category,
      isReviewed: row.is_reviewed,
      monthYear: row.month_year,
      notes: row.notes,
      institution: row.institution,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  static _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

module.exports = Transaction;
