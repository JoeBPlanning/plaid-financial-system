const { getDatabase } = require('../database-supabase');
const { encryptPlaidToken, decryptPlaidToken } = require('../utils/encryption');

class Client {
  static async findOne(query) {
    const supabase = getDatabase();

    // Build query
    let dbQuery = supabase.from('clients').select(`
      *,
      plaid_connections (
        access_token,
        item_id,
        institution_name,
        institution_id,
        account_ids,
        is_active,
        connected_at,
        transaction_cursor
      )
    `);

    // Apply filters
    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    const { data, error } = await dbQuery.single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return this._mapToModel(data);
  }

  static async find(query = {}) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('clients').select(`
      *,
      plaid_connections (
        access_token,
        item_id,
        institution_name,
        institution_id,
        account_ids,
        is_active,
        connected_at,
        transaction_cursor
      )
    `);

    // Apply filters
    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    const { data, error } = await dbQuery;

    if (error) throw error;

    return data.map(row => this._mapToModel(row));
  }

  static async create(clientData) {
    const supabase = getDatabase();

    // Separate plaid tokens from client data
    const { plaidAccessTokens, ...clientFields } = clientData;

    // Insert client
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert([{
        client_id: clientFields.clientId,
        username: clientFields.username || null,
        name: clientFields.name,
        email: clientFields.email,
        password: clientFields.password || null,
        is_active: clientFields.isActive !== undefined ? clientFields.isActive : true,
        advisor_id: clientFields.advisorId,
        preferences: clientFields.preferences || {},
        client_profile: clientFields.clientProfile || {}
      }])
      .select()
      .single();

    if (clientError) throw clientError;

    // Insert plaid tokens if provided (encrypt access tokens)
    if (plaidAccessTokens && plaidAccessTokens.length > 0) {
      const tokens = plaidAccessTokens.map(token => ({
        client_id: client.client_id,
        access_token: encryptPlaidToken(token.accessToken), // Encrypt before storing
        item_id: token.itemId,
        institution_name: token.institutionName,
        institution_id: token.institutionId,
        account_ids: token.accountIds || [],
        is_active: token.isActive !== undefined ? token.isActive : true,
        transaction_cursor: token.transactionCursor || null
      }));

      const { error: tokenError } = await supabase
        .from('plaid_connections')
        .insert(tokens);

      if (tokenError) throw tokenError;
    }

    return this.findOne({ clientId: client.client_id });
  }

  static async update(clientData) {
    const supabase = getDatabase();

    const { plaidAccessTokens, clientId, ...updates } = clientData;

    // Update client
    const { error: updateError } = await supabase
      .from('clients')
      .update({
        username: updates.username || null,
        name: updates.name,
        email: updates.email,
        password: updates.password || null,
        is_active: updates.isActive !== undefined ? updates.isActive : true,
        advisor_id: updates.advisorId,
        preferences: updates.preferences || {},
        client_profile: updates.clientProfile || {}
      })
      .eq('client_id', clientId);

    if (updateError) throw updateError;

    // Update plaid tokens if provided
    if (plaidAccessTokens !== undefined) {
      // Delete existing tokens
      await supabase
        .from('plaid_connections')
        .delete()
        .eq('client_id', clientId);

      // Insert new tokens (encrypt access tokens)
      if (plaidAccessTokens.length > 0) {
        const tokens = plaidAccessTokens.map(token => ({
          client_id: clientId,
          access_token: encryptPlaidToken(token.accessToken), // Encrypt before storing
          item_id: token.itemId,
          institution_name: token.institutionName,
          institution_id: token.institutionId,
          account_ids: token.accountIds || [],
          is_active: token.isActive !== undefined ? token.isActive : true,
          transaction_cursor: token.transactionCursor || null
        }));

        const { error: tokenError } = await supabase
          .from('plaid_connections')
          .insert(tokens);

        if (tokenError) throw tokenError;
      }
    }

    return this.findOne({ clientId });
  }

  static async addPlaidTokenToClient(clientId, tokenData) {
    const supabase = getDatabase();

    const { error } = await supabase
      .from('plaid_connections')
      .insert([{
        client_id: clientId,
        access_token: encryptPlaidToken(tokenData.accessToken), // Encrypt before storing
        item_id: tokenData.itemId,
        institution_name: tokenData.institutionName,
        institution_id: tokenData.institutionId,
        account_ids: tokenData.accountIds || [],
        is_active: tokenData.isActive !== undefined ? tokenData.isActive : true,
        transaction_cursor: tokenData.transactionCursor || null
      }]);

    if (error) throw error;

    return this.findOne({ clientId });
  }

  static async findOneAndUpdate(query, update, options = {}) {
    const existing = await this.findOne(query);

    if (!existing && !options.upsert) {
      return null;
    }

    if (!existing && options.upsert) {
      return this.create({ ...query, ...update });
    }

    const updated = { ...existing, ...update };
    return this.update(updated);
  }

  static async deleteOne(query) {
    const supabase = getDatabase();

    const dbKey = this._toSnakeCase(Object.keys(query)[0]);
    const value = query[Object.keys(query)[0]];

    const { error } = await supabase
      .from('clients')
      .delete()
      .eq(dbKey, value);

    if (error) throw error;

    return { deletedCount: 1 };
  }

  static _mapToModel(data) {
    if (!data) return null;

    const plaidAccessTokens = (data.plaid_connections || []).map(conn => ({
      accessToken: decryptPlaidToken(conn.access_token), // Decrypt when reading
      itemId: conn.item_id,
      institutionName: conn.institution_name,
      institutionId: conn.institution_id,
      accountIds: conn.account_ids,
      isActive: conn.is_active,
      connectedAt: conn.connected_at,
      transactionCursor: conn.transaction_cursor
    }));

    return {
      id: data.id,
      clientId: data.client_id,
      username: data.username,
      name: data.name,
      email: data.email,
      password: data.password,
      isActive: data.is_active,
      advisorId: data.advisor_id,
      preferences: data.preferences,
      clientProfile: data.client_profile,
      plaidAccessTokens,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      toObject: function() {
        const obj = { ...this };
        delete obj.save;
        delete obj.toObject;
        return obj;
      },
      save: async function() {
        return Client.update(this);
      }
    };
  }

  static _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

module.exports = Client;
