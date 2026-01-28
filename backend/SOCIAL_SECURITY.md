# Social Security Manager

A CLI tool for managing Social Security information for clients.

## Setup

First, run the migration to create the required database tables:

```sql
-- Run this in your Supabase SQL Editor
-- Copy contents from: migrations/009_social_security.sql
```

## Usage

### List All Clients

```bash
cd backend
npm run ss -- --action list-clients
```

### View Client's SS Data

```bash
# By client ID
npm run ss -- --client <client-uuid> --action view

# By email
npm run ss -- --client joe@example.com --action view
```

### Add SS Data with Projection

Create a projection based on birthdate and current income:

```bash
npm run ss -- --client joe@example.com --action add-manual --birthdate 1970-05-15 --income 100000
```

This will calculate:
- Full Retirement Age (FRA)
- Primary Insurance Amount (PIA)
- Monthly benefits at ages 62-70
- Disability benefit estimate
- Survivor benefit estimate
- Medicare eligibility (estimated credits)

### Add Earnings History

Add actual earnings for a specific year:

```bash
npm run ss -- --client joe@example.com --action add-earnings --year 2023 --earnings 150000
```

This automatically calculates:
- Social Security tax paid (6.2% up to wage base)
- Medicare tax paid (1.45%)
- Employer matching contributions
- Credits earned (up to 4 per year)

### Add Benefits from Statement

If you have actual benefit amounts from a Social Security statement:

```bash
npm run ss -- --client joe@example.com --action add-benefits \
  --benefit-62 1850 \
  --benefit-67 2650 \
  --benefit-70 3286
```

## Data Stored

### Social Security Table
- Birth date and Full Retirement Age
- Estimated benefits at ages 62-70
- Primary Insurance Amount (PIA)
- Disability benefit
- Survivor benefit
- Medicare credits and eligibility
- Total contributions (employee + employer)

### Earnings History Table
- Year-by-year earnings
- Social Security taxable earnings (capped at wage base)
- Medicare taxable earnings (no cap)
- Taxes paid (employee and employer)
- Credits earned per year

## Social Security Calculations

### Full Retirement Age (FRA)
- Born 1943-1954: 66 years
- Born 1955: 66 years, 2 months
- Born 1956: 66 years, 4 months
- Born 1957: 66 years, 6 months
- Born 1958: 66 years, 8 months
- Born 1959: 66 years, 10 months
- Born 1960+: 67 years

### Benefit Adjustments
- **Early claiming (before FRA)**: Reduced by ~6.67% per year for first 3 years, 5% per year after
- **Delayed claiming (after FRA)**: Increased by 8% per year up to age 70

### Medicare Eligibility
- Need 40 credits (10 years of work)
- Earn up to 4 credits per year
- 2024: 1 credit per $1,730 of earnings

## 2024 Constants

| Item | Value |
|------|-------|
| SS Tax Rate | 6.2% (employee + 6.2% employer) |
| Medicare Tax Rate | 1.45% (employee + 1.45% employer) |
| SS Wage Base | $168,600 |
| Credit Amount | $1,730 per credit |

## Future Enhancements

- [ ] PDF statement parsing with OCR
- [ ] Spousal benefit calculations
- [ ] Break-even analysis for claiming age
- [ ] Integration with dashboard display
