# Generating Client PDF Reports

This guide explains how to generate PDF financial reports for clients from the terminal.

## Prerequisites

Make sure you're in the backend directory and have dependencies installed:

```bash
cd backend
npm install
```

## Quick Start

Generate reports for all clients:

```bash
npm run generate-reports
```

Reports will be saved to the `./reports/` directory.

## Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--client <clientId>` | Generate report for a specific client only | All clients |
| `--output <dir>` | Output directory for PDF files | `./reports` |
| `--months <n>` | Number of months to include (max 12) | `12` |

## Examples

### Generate reports for all clients
```bash
npm run generate-reports
```

### Generate report for a specific client
```bash
npm run generate-reports -- --client 2df2e53d-87b0-4f6b-ad01-01ea6cba53dd
```

### Save to a custom directory
```bash
npm run generate-reports -- --output ./my-reports
```

### Limit to last 6 months
```bash
npm run generate-reports -- --months 6
```

### Combine multiple options
```bash
npm run generate-reports -- --client abc123 --output ./custom-folder --months 6
```

## What's Included in Each Report

Each PDF report contains:

### Page 1: Summary & Bar Chart
- **Header** with client name and report period
- **Summary Statistics**
  - Total Income
  - Total Expenses
  - Net Savings
  - Number of months analyzed
- **Stacked Bar Chart** showing monthly expenses by category

### Page 2: Pie Chart & Details
- **Pie/Doughnut Chart** showing expense breakdown by category
- **Category Details Table** with:
  - Category name
  - Total amount
  - Percentage of total expenses
  - Monthly average

## Output

### File Location
Reports are saved to the output directory (default: `./reports/`)

### Filename Format
```
ClientName_Financial_Report_YYYY-MM-DD.pdf
```

Example: `Joseph_Bautista_Financial_Report_2026-01-27.pdf`

## Troubleshooting

### "No financial data available"
The client has no monthly summaries in the database. Make sure they have:
1. Connected bank accounts
2. Synced transactions
3. Processed transactions to generate summaries

### "Client not found"
Check that the `--client` ID is correct. You can find client IDs in:
- The Supabase dashboard (`clients` table)
- The admin dashboard

### Canvas/Chart errors
If you see canvas-related errors, ensure the `canvas` package is properly installed:
```bash
npm rebuild canvas
```

## Environment

The script uses `.env.development` by default. Make sure your Supabase credentials are configured:

```env
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```
