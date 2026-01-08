const { getDatabase } = require('../database-supabase');

class SocialSecurity {
  /**
   * Find a single Social Security record by query
   * @param {Object} query - Query object (e.g., { clientId: 'uuid' })
   * @returns {Promise<Object|null>} Social Security data or null
   */
  static async findOne(query) {
    const supabase = getDatabase();

    // Build query
    let dbQuery = supabase.from('social_security_data').select('*');

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

  /**
   * Find Social Security records by query
   * @param {Object} query - Query object
   * @returns {Promise<Array>} Array of Social Security records
   */
  static async find(query = {}) {
    const supabase = getDatabase();

    let dbQuery = supabase.from('social_security_data').select('*');

    // Apply filters
    Object.keys(query).forEach(key => {
      const dbKey = this._toSnakeCase(key);
      dbQuery = dbQuery.eq(dbKey, query[key]);
    });

    const { data, error } = await dbQuery;

    if (error) throw error;

    return data.map(row => this._mapToModel(row));
  }

  /**
   * Create a new Social Security record
   * @param {Object} ssData - Social Security data
   * @returns {Promise<Object>} Created record
   */
  static async create(ssData) {
    const supabase = getDatabase();

    const { data, error } = await supabase
      .from('social_security_data')
      .insert([this._mapToDb(ssData)])
      .select()
      .single();

    if (error) throw error;

    return this._mapToModel(data);
  }

  /**
   * Update or create Social Security record
   * @param {Object} query - Query to find existing record
   * @param {Object} ssData - Data to update/create
   * @param {Object} options - Options (e.g., { upsert: true, new: true })
   * @returns {Promise<Object>} Updated/created record
   */
  static async findOneAndUpdate(query, ssData, options = {}) {
    const supabase = getDatabase();

    // First, try to find existing record
    const existing = await this.findOne(query);

    if (existing) {
      // Update existing record
      const dbKey = this._toSnakeCase(Object.keys(query)[0]);
      const { data, error } = await supabase
        .from('social_security_data')
        .update(this._mapToDb(ssData))
        .eq(dbKey, query[Object.keys(query)[0]])
        .select()
        .single();

      if (error) throw error;

      return this._mapToModel(data);
    } else if (options.upsert) {
      // Create new record
      return await this.create({ ...query, ...ssData });
    } else {
      return null;
    }
  }

  /**
   * Delete a Social Security record
   * @param {Object} query - Query to find record to delete
   * @returns {Promise<boolean>} Success
   */
  static async deleteOne(query) {
    const supabase = getDatabase();

    const dbKey = this._toSnakeCase(Object.keys(query)[0]);
    const { error } = await supabase
      .from('social_security_data')
      .delete()
      .eq(dbKey, query[Object.keys(query)[0]]);

    if (error) throw error;

    return true;
  }

  /**
   * Calculate Present Value of Social Security benefits
   * Includes COLA (Cost of Living Adjustment) inflation for realistic projections
   *
   * Formula: Sums discounted future benefits with inflation adjustment
   * PV = Σ (Annual_Benefit × (1 + inflation)^year) / (1 + discount)^(years_until + year)
   *
   * @param {number} monthlyBenefit - Monthly Social Security benefit amount at claiming age
   * @param {number} claimingAge - Age when benefits start (62-70)
   * @param {number} currentAge - Current age of the client
   * @param {number} lifeExpectancy - Expected lifespan (default: 90)
   * @param {number} discountRate - Annual discount rate (default: 0.03 = 3%)
   * @param {number} inflationRate - Annual COLA adjustment (default: 0.025 = 2.5%)
   * @returns {number} Present value of lifetime benefits
   */
  static calculatePresentValue(
    monthlyBenefit,
    claimingAge,
    currentAge,
    lifeExpectancy = 90,
    discountRate = 0.03,
    inflationRate = 0.025
  ) {
    // Validate inputs
    if (!monthlyBenefit || monthlyBenefit <= 0) return 0;
    if (claimingAge < 62 || claimingAge > 70) {
      throw new Error('Claiming age must be between 62 and 70');
    }
    if (currentAge > lifeExpectancy) return 0;
    if (claimingAge >= lifeExpectancy) return 0;

    // Calculate number of years receiving benefits
    const yearsOfBenefits = lifeExpectancy - claimingAge;
    if (yearsOfBenefits <= 0) return 0;

    // Calculate years until benefits start
    const yearsUntilClaiming = Math.max(0, claimingAge - currentAge);

    // Calculate present value with COLA inflation adjustment
    let presentValue = 0;

    for (let year = 0; year < yearsOfBenefits; year++) {
      // Adjust annual benefit for inflation (COLA)
      const inflationAdjusted = monthlyBenefit * 12 * Math.pow(1 + inflationRate, year);

      // Discount factor: (1 + r)^(years_until_claiming + year)
      const discountFactor = Math.pow(1 + discountRate, yearsUntilClaiming + year);

      // Add discounted benefit to present value
      presentValue += inflationAdjusted / discountFactor;
    }

    // Round to nearest dollar
    return Math.round(presentValue);
  }

  /**
   * Calculate Present Value with simplified formula (no inflation)
   * Used for quick estimates when COLA adjustment is not needed
   *
   * @param {number} monthlyBenefit - Monthly benefit amount
   * @param {number} claimingAge - Age when benefits start (62-70)
   * @param {number} currentAge - Current age
   * @param {number} lifeExpectancy - Expected lifespan (default: 90)
   * @param {number} discountRate - Annual discount rate (default: 0.03)
   * @returns {number} Present value without inflation adjustment
   */
  static calculatePresentValueSimple(
    monthlyBenefit,
    claimingAge,
    currentAge,
    lifeExpectancy = 90,
    discountRate = 0.03
  ) {
    // This is the simpler formula without COLA
    // Uses the annuity formula for constant payments
    if (!monthlyBenefit || monthlyBenefit <= 0) return 0;
    if (claimingAge < 62 || claimingAge > 70) return 0;
    if (currentAge > lifeExpectancy || claimingAge >= lifeExpectancy) return 0;

    const monthlyRate = discountRate / 12;
    const yearsUntilStart = Math.max(0, claimingAge - currentAge);
    const yearsOfPayments = lifeExpectancy - claimingAge;
    if (yearsOfPayments <= 0) return 0;

    const numberOfPayments = yearsOfPayments * 12;

    // Present Value of Annuity
    let pvAnnuity;
    if (monthlyRate === 0) {
      pvAnnuity = monthlyBenefit * numberOfPayments;
    } else {
      pvAnnuity = monthlyBenefit *
        ((1 - Math.pow(1 + monthlyRate, -numberOfPayments)) / monthlyRate);
    }

    // Discount to present
    const monthsUntilStart = yearsUntilStart * 12;
    const presentValue = pvAnnuity / Math.pow(1 + monthlyRate, monthsUntilStart);

    return Math.round(presentValue);
  }

  /**
   * Calculate optimal claiming age based on break-even analysis
   * Compares total lifetime benefits at different claiming ages with COLA adjustments
   *
   * @param {Object} benefits - Object with benefit_at_62, benefit_at_fra, benefit_at_70, full_retirement_age
   * @param {number} currentAge - Current age of client
   * @param {number} lifeExpectancy - Expected lifespan (default: 90)
   * @param {number} discountRate - Annual discount rate (default: 0.03)
   * @param {number} inflationRate - Annual COLA adjustment (default: 0.025)
   * @returns {Object} Analysis showing PV at each claiming age and recommendation
   */
  static calculateOptimalClaimingAge(
    benefits,
    currentAge,
    lifeExpectancy = 90,
    discountRate = 0.03,
    inflationRate = 0.025
  ) {
    const ages = [
      { age: 62, benefit: benefits.benefit_at_62 },
      { age: benefits.full_retirement_age || 67, benefit: benefits.benefit_at_fra },
      { age: 70, benefit: benefits.benefit_at_70 }
    ].filter(item => item.benefit > 0);

    const analysis = ages.map(({ age, benefit }) => {
      const pv = this.calculatePresentValue(
        benefit,
        age,
        currentAge,
        lifeExpectancy,
        discountRate,
        inflationRate
      );

      // Also calculate total nominal dollars (without discounting)
      const yearsOfBenefits = lifeExpectancy - age;
      let totalNominal = 0;
      for (let year = 0; year < yearsOfBenefits; year++) {
        totalNominal += benefit * 12 * Math.pow(1 + inflationRate, year);
      }

      return {
        claimingAge: age,
        monthlyBenefit: benefit,
        presentValue: pv,
        totalNominalBenefits: Math.round(totalNominal),
        yearsOfBenefits
      };
    });

    // Find age with highest present value
    const optimal = analysis.reduce((max, item) =>
      item.presentValue > max.presentValue ? item : max
    , analysis[0]);

    return {
      analysis,
      recommendation: optimal.claimingAge,
      maxPresentValue: optimal.presentValue,
      assumptions: {
        currentAge,
        lifeExpectancy,
        discountRate: (discountRate * 100).toFixed(1) + '%',
        inflationRate: (inflationRate * 100).toFixed(1) + '%'
      }
    };
  }

  // ======================
  // Helper Methods
  // ======================

  /**
   * Convert camelCase to snake_case
   */
  static _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  /**
   * Convert snake_case to camelCase
   */
  static _toCamelCase(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Map database row to model object (snake_case to camelCase)
   */
  static _mapToModel(data) {
    if (!data) return null;

    return {
      id: data.id,
      clientId: data.client_id,
      dateOfBirth: data.date_of_birth,
      fullRetirementAge: data.full_retirement_age,
      benefitAt62: data.benefit_at_62,
      benefitAtFra: data.benefit_at_fra,
      benefitAt70: data.benefit_at_70,
      currentAnnualEarnings: data.current_annual_earnings,
      yearsOfSubstantialEarnings: data.years_of_substantial_earnings,
      estimatedSsaStartAge: data.estimated_ssa_start_age,
      estimatedMonthlyBenefit: data.estimated_monthly_benefit,
      presentValueOfBenefits: data.present_value_of_benefits,
      lastUpdated: data.last_updated,
      statementUploadPath: data.statement_upload_path,
      notes: data.notes,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  }

  /**
   * Map model object to database row (camelCase to snake_case)
   */
  static _mapToDb(data) {
    const dbData = {};

    if (data.clientId !== undefined) dbData.client_id = data.clientId;
    if (data.dateOfBirth !== undefined) dbData.date_of_birth = data.dateOfBirth;
    if (data.fullRetirementAge !== undefined) dbData.full_retirement_age = data.fullRetirementAge;
    if (data.benefitAt62 !== undefined) dbData.benefit_at_62 = data.benefitAt62;
    if (data.benefitAtFra !== undefined) dbData.benefit_at_fra = data.benefitAtFra;
    if (data.benefitAt70 !== undefined) dbData.benefit_at_70 = data.benefitAt70;
    if (data.currentAnnualEarnings !== undefined) dbData.current_annual_earnings = data.currentAnnualEarnings;
    if (data.yearsOfSubstantialEarnings !== undefined) dbData.years_of_substantial_earnings = data.yearsOfSubstantialEarnings;
    if (data.estimatedSsaStartAge !== undefined) dbData.estimated_ssa_start_age = data.estimatedSsaStartAge;
    if (data.estimatedMonthlyBenefit !== undefined) dbData.estimated_monthly_benefit = data.estimatedMonthlyBenefit;
    if (data.presentValueOfBenefits !== undefined) dbData.present_value_of_benefits = data.presentValueOfBenefits;
    if (data.lastUpdated !== undefined) dbData.last_updated = data.lastUpdated;
    if (data.statementUploadPath !== undefined) dbData.statement_upload_path = data.statementUploadPath;
    if (data.notes !== undefined) dbData.notes = data.notes;

    return dbData;
  }
}

module.exports = SocialSecurity;
