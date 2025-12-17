const { getDatabase } = require('../database');

class Client {
  static findOne(query) {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM clients WHERE ' + Object.keys(query).map(k => `${k} = ?`).join(' AND '));
    const params = Object.values(query);
    const row = stmt.get(...params);
    
    if (!row) return null;
    
    const plaidTokens = Client.getPlaidTokens(row.clientId);
    const client = {
      ...row,
      isActive: row.isActive === 1,
      preferences: JSON.parse(row.preferences || '{}'),
      clientProfile: JSON.parse(row.clientProfile || '{}'),
      plaidAccessTokens: plaidTokens,
      toObject: function() { 
        const obj = { ...this };
        delete obj.save;
        return obj;
      },
      save: async function() { 
        // Save the client data
        await Client.update(this);
        
        // Always update plaid tokens from the current array
        const db = getDatabase();
        const deleteStmt = db.prepare('DELETE FROM plaid_access_tokens WHERE clientId = ?');
        deleteStmt.run(this.clientId);
        
        if (this.plaidAccessTokens && this.plaidAccessTokens.length > 0) {
          Client.addPlaidTokens(this.clientId, this.plaidAccessTokens);
        }
        
        return Client.findOne({ clientId: this.clientId });
      }
    };
    
    return client;
  }

  static find(query = {}) {
    const db = getDatabase();
    let sql = 'SELECT * FROM clients';
    const conditions = [];
    const params = [];

    if (Object.keys(query).length > 0) {
      Object.keys(query).forEach(key => {
        conditions.push(`${key} = ?`);
        params.push(query[key]);
      });
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const stmt = db.prepare(sql);
    const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
    
    return rows.map(row => ({
      ...row,
      plaidAccessTokens: Client.getPlaidTokens(row.clientId),
      toObject: function() { return this; },
      save: async function() { return Client.update(this); }
    }));
  }

  static getPlaidTokens(clientId) {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM plaid_access_tokens WHERE clientId = ?');
    const rows = stmt.all(clientId);
    
    return rows.map(row => ({
      accessToken: row.accessToken,
      itemId: row.itemId,
      institutionName: row.institutionName,
      institutionId: row.institutionId,
      accountIds: JSON.parse(row.accountIds || '[]'),
      isActive: row.isActive === 1,
      connectedAt: row.connectedAt,
      transactionCursor: row.transactionCursor
    }));
  }

  static async create(data) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO clients (clientId, username, name, email, password, isActive, advisorId, preferences, clientProfile)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = insert.run(
      data.clientId,
      data.username || null,
      data.name,
      data.email,
      data.password || null,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1,
      data.advisorId,
      JSON.stringify(data.preferences || {}),
      JSON.stringify(data.clientProfile || {})
    );

    // Add Plaid tokens if provided
    if (data.plaidAccessTokens && data.plaidAccessTokens.length > 0) {
      Client.addPlaidTokens(data.clientId, data.plaidAccessTokens);
    }

    return Client.findOne({ clientId: data.clientId });
  }

  static addPlaidTokens(clientId, tokens) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO plaid_access_tokens 
      (clientId, accessToken, itemId, institutionName, institutionId, accountIds, isActive, transactionCursor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((tokens) => {
      for (const token of tokens) {
        insert.run(
          clientId,
          token.accessToken,
          token.itemId,
          token.institutionName,
          token.institutionId,
          JSON.stringify(token.accountIds || []),
          token.isActive !== undefined ? (token.isActive ? 1 : 0) : 1,
          token.transactionCursor || null
        );
      }
    });

    insertMany(tokens);
  }

  static async update(data) {
    const db = getDatabase();
    const update = db.prepare(`
      UPDATE clients 
      SET username = ?, name = ?, email = ?, password = ?, isActive = ?, 
          advisorId = ?, preferences = ?, clientProfile = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE clientId = ?
    `);

    update.run(
      data.username || null,
      data.name,
      data.email,
      data.password || null,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1,
      data.advisorId,
      JSON.stringify(data.preferences || {}),
      JSON.stringify(data.clientProfile || {}),
      data.clientId
    );

    // Update Plaid tokens if provided
    if (data.plaidAccessTokens) {
      // Delete existing tokens
      const deleteStmt = db.prepare('DELETE FROM plaid_access_tokens WHERE clientId = ?');
      deleteStmt.run(data.clientId);
      
      // Add new tokens
      if (data.plaidAccessTokens.length > 0) {
        Client.addPlaidTokens(data.clientId, data.plaidAccessTokens);
      }
    }

    return Client.findOne({ clientId: data.clientId });
  }

  static async addPlaidTokenToClient(clientId, tokenData) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO plaid_access_tokens 
      (clientId, accessToken, itemId, institutionName, institutionId, accountIds, isActive, transactionCursor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      clientId,
      tokenData.accessToken,
      tokenData.itemId,
      tokenData.institutionName,
      tokenData.institutionId,
      JSON.stringify(tokenData.accountIds || []),
      tokenData.isActive !== undefined ? (tokenData.isActive ? 1 : 0) : 1,
      tokenData.transactionCursor || null
    );

    return Client.findOne({ clientId });
  }

  static findOneAndUpdate(query, update, options = {}) {
    const existing = Client.findOne(query);
    if (!existing && !options.upsert) {
      return null;
    }

    if (!existing && options.upsert) {
      return Client.create({ ...query, ...update });
    }

    const updated = { ...existing, ...update };
    return Client.update(updated);
  }

  static deleteOne(query) {
    const db = getDatabase();
    const conditions = [];
    const params = [];

    Object.keys(query).forEach(key => {
      conditions.push(`${key} = ?`);
      params.push(query[key]);
    });

    if (conditions.length === 0) {
      return { changes: 0 };
    }

    const sql = 'DELETE FROM clients WHERE ' + conditions.join(' AND ');
    const deleteStmt = db.prepare(sql);
    return deleteStmt.run(...params);
  }
}

module.exports = Client;

