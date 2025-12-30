const { getDatabase } = require('../database-supabase');

class Document {
  static async find(query = {}) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('documents').select('*');

    // Apply filters
    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    dbQuery = dbQuery.order('generated_at', { ascending: false });

    const { data, error } = await dbQuery;

    if (error) throw error;

    return data.map(row => this._mapToModel(row));
  }

  static async findOne(query) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('documents').select('*');

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
      .from('documents')
      .insert([{
        client_id: data.clientId,
        document_type: data.documentType,
        title: data.title,
        description: data.description || null,
        file_path: data.filePath || null,
        file_url: data.fileUrl || null,
        month_year: data.monthYear || null,
        year: data.year || null,
        metadata: data.metadata || {}
      }])
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(created);
  }

  static async update(id, data) {
    const supabase = getDatabase();

    const { error, data: updated } = await supabase
      .from('documents')
      .update({
        title: data.title,
        description: data.description,
        file_path: data.filePath,
        file_url: data.fileUrl,
        metadata: data.metadata
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(updated);
  }

  static async deleteOne(query) {
    const supabase = getDatabase();

    const dbKey = this._toSnakeCase(Object.keys(query)[0]);
    const value = query[Object.keys(query)[0]];

    const { error } = await supabase
      .from('documents')
      .delete()
      .eq(dbKey, value);

    if (error) throw error;

    return { deletedCount: 1 };
  }

  static _mapToModel(row) {
    if (!row) return null;

    return {
      id: row.id,
      clientId: row.client_id,
      documentType: row.document_type,
      title: row.title,
      description: row.description,
      filePath: row.file_path,
      fileUrl: row.file_url,
      monthYear: row.month_year,
      year: row.year,
      metadata: row.metadata,
      generatedAt: row.generated_at ? new Date(row.generated_at) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  static _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

module.exports = Document;
