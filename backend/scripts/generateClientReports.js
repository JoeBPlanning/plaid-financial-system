#!/usr/bin/env node
/**
 * Generate PDF Reports for All Clients
 * 
 * Usage: node scripts/generateClientReports.js [options]
 * 
 * Options:
 *   --client <clientId>  Generate report for specific client only
 *   --output <dir>       Output directory (default: ./reports)
 *   --months <n>         Number of months to include (default: 12, max: 12)
 * 
 * Example:
 *   node scripts/generateClientReports.js
 *   node scripts/generateClientReports.js --client abc123 --output ./my-reports
 */

require('dotenv').config({ path: '.env.development' });

const fs = require('fs');
const path = require('path');
const moment = require('moment');
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// Initialize database
const { initDatabase, getDatabase } = require('../database-supabase');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

// Default to user's Downloads folder
const homeDir = require('os').homedir();
const defaultOutput = require('path').join(homeDir, 'Downloads');

const CONFIG = {
  clientId: getArg('client'),
  outputDir: getArg('output') || defaultOutput,
  months: Math.min(parseInt(getArg('months')) || 12, 12)
};

// Colors
const COLORS = {
  primary: '#667eea',
  categoryColors: [
    '#667eea', '#764ba2', '#ff6b35', '#28a745', '#ffc107',
    '#17a2b8', '#dc3545', '#6c757d', '#e83e8c', '#20c997',
    '#6610f2', '#fd7e14', '#6f42c1', '#20c997', '#343a40'
  ]
};

// Category labels for display
const CATEGORY_LABELS = {
  housing: 'Housing',
  billAndUtilities: 'Bills & Utilities',
  autoAndTransport: 'Auto & Transport',
  insurance: 'Insurance',
  loanPayment: 'Loan Payment',
  groceries: 'Groceries',
  healthAndFitness: 'Health & Fitness',
  shopping: 'Shopping',
  diningOut: 'Dining Out',
  entertainment: 'Entertainment',
  travel: 'Travel',
  charitableGiving: 'Charitable Giving',
  business: 'Business',
  kids: 'Kids',
  education: 'Education',
  gift: 'Gift',
  feeAndCharges: 'Fees & Charges',
  misc: 'Miscellaneous',
  uncategorized: 'Uncategorized'
};

/**
 * Fetch monthly summaries for a client
 */
async function getClientSummaries(clientId, months) {
  const supabase = getDatabase();
  
  const { data, error } = await supabase
    .from('monthly_summaries')
    .select('*')
    .eq('client_id', clientId)
    .order('month_year', { ascending: false })
    .limit(months);
  
  if (error) {
    console.error(`Error fetching summaries for ${clientId}:`, error);
    return [];
  }
  
  // Map snake_case to camelCase for compatibility
  return (data || []).map(s => ({
    ...s,
    clientId: s.client_id,
    monthYear: s.month_year,
    cashFlow: s.cash_flow
  }));
}

/**
 * Get all clients
 */
async function getAllClients() {
  const supabase = getDatabase();
  
  const { data, error } = await supabase
    .from('clients')
    .select('client_id, name, email');
  
  if (error) {
    console.error('Error fetching clients:', error);
    return [];
  }
  
  // Map snake_case to camelCase
  return (data || []).map(c => ({
    clientId: c.client_id,
    name: c.name,
    email: c.email
  }));
}

/**
 * Render stacked bar chart of expenses by month
 */
async function renderStackedExpenseChart(summaries) {
  const width = 800;
  const height = 400;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
  
  // Sort summaries by date (oldest first)
  const sortedSummaries = [...summaries].sort((a, b) => 
    a.monthYear.localeCompare(b.monthYear)
  );
  
  // Get months labels
  const months = sortedSummaries.map(s => 
    moment(s.monthYear, 'YYYY-MM').format('MMM YY')
  );
  
  // Get all expense categories that have data
  const expenseCategories = Object.keys(CATEGORY_LABELS).filter(cat => {
    return sortedSummaries.some(s => s.cashFlow && s.cashFlow[cat] > 0);
  });
  
  // Build datasets for each category
  const datasets = expenseCategories.map((cat, idx) => ({
    label: CATEGORY_LABELS[cat] || cat,
    data: sortedSummaries.map(s => (s.cashFlow && s.cashFlow[cat]) || 0),
    backgroundColor: COLORS.categoryColors[idx % COLORS.categoryColors.length],
    stack: 'expenses'
  }));
  
  const configuration = {
    type: 'bar',
    data: {
      labels: months,
      datasets: datasets
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: `Monthly Expenses by Category (${months.length} Months)`,
          font: { size: 18, weight: 'bold' },
          color: '#333',
          padding: { bottom: 20 }
        },
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            padding: 8,
            font: { size: 9 }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { size: 10 } }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: '#e1e5e9' },
          ticks: {
            font: { size: 10 },
            callback: (value) => '$' + value.toLocaleString()
          }
        }
      }
    },
    plugins: [{
      id: 'background',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };
  
  return await chartJSNodeCanvas.renderToBuffer(configuration);
}

/**
 * Render pie chart of expense categories (aggregated)
 */
async function renderExpensePieChart(summaries, clientName) {
  const width = 700;
  const height = 500;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
  
  // Aggregate expenses across all months
  const categoryTotals = {};
  
  summaries.forEach(summary => {
    if (!summary.cashFlow) return;
    
    Object.keys(CATEGORY_LABELS).forEach(cat => {
      const amount = summary.cashFlow[cat] || 0;
      if (amount > 0) {
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
      }
    });
  });
  
  // Sort by amount and filter out zero values
  const sortedCategories = Object.entries(categoryTotals)
    .filter(([_, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);
  
  const totalExpenses = sortedCategories.reduce((sum, [_, amount]) => sum + amount, 0);
  
  const labels = sortedCategories.map(([cat, amount]) => {
    const pct = ((amount / totalExpenses) * 100).toFixed(1);
    return `${CATEGORY_LABELS[cat] || cat} (${pct}%)`;
  });
  
  const data = sortedCategories.map(([_, amount]) => amount);
  
  const configuration = {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: COLORS.categoryColors.slice(0, labels.length),
        borderColor: 'white',
        borderWidth: 2
      }]
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: `Expense Breakdown - Total: $${totalExpenses.toLocaleString()}`,
          font: { size: 18, weight: 'bold' },
          color: '#333',
          padding: { bottom: 20 }
        },
        legend: {
          position: 'right',
          labels: {
            boxWidth: 12,
            padding: 10,
            font: { size: 10 }
          }
        }
      }
    },
    plugins: [{
      id: 'background',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };
  
  return await chartJSNodeCanvas.renderToBuffer(configuration);
}

/**
 * Generate PDF report for a client
 */
async function generateClientPDF(client, summaries, outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true
      });
      
      const writeStream = fs.createWriteStream(outputPath);
      doc.pipe(writeStream);
      
      // Header
      doc
        .rect(0, 0, 612, 80)
        .fill(COLORS.primary);
      
      doc
        .fillColor('white')
        .fontSize(24)
        .font('Helvetica-Bold')
        .text('Financial Summary Report', 50, 25, { align: 'center', width: 512 });
      
      doc
        .fontSize(14)
        .font('Helvetica')
        .text(client.name, 50, 52, { align: 'center', width: 512 });
      
      doc.fillColor('#333');
      doc.y = 100;
      
      // Report info
      const dateRange = summaries.length > 0 
        ? `${moment(summaries[summaries.length - 1].monthYear, 'YYYY-MM').format('MMM YYYY')} - ${moment(summaries[0].monthYear, 'YYYY-MM').format('MMM YYYY')}`
        : 'No data available';
      
      doc
        .fontSize(12)
        .font('Helvetica')
        .text(`Report Period: ${dateRange}`, { align: 'center' })
        .text(`Generated: ${moment().format('MMMM D, YYYY')}`, { align: 'center' })
        .moveDown(2);
      
      if (summaries.length === 0) {
        doc
          .fontSize(14)
          .text('No financial data available for this client.', { align: 'center' });
        doc.end();
        writeStream.on('finish', () => resolve(outputPath));
        return;
      }
      
      // Calculate totals
      let totalIncome = 0;
      let totalExpenses = 0;
      
      summaries.forEach(s => {
        if (s.cashFlow) {
          totalIncome += s.cashFlow.income || 0;
          totalExpenses += s.cashFlow.totalExpenses || 0;
        }
      });
      
      // Summary stats
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('Summary Statistics', { underline: true })
        .moveDown(0.5);
      
      doc
        .fontSize(12)
        .font('Helvetica')
        .text(`Total Income: $${totalIncome.toLocaleString()}`)
        .text(`Total Expenses: $${totalExpenses.toLocaleString()}`)
        .text(`Net Savings: $${(totalIncome - totalExpenses).toLocaleString()}`)
        .text(`Months Analyzed: ${summaries.length}`)
        .moveDown(2);
      
      // Stacked bar chart
      console.log(`  📊 Generating expense bar chart...`);
      const barChart = await renderStackedExpenseChart(summaries);
      
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Monthly Expenses by Category')
        .moveDown(0.5);
      
      doc.image(barChart, 50, doc.y, { width: 512 });
      doc.y += 280;
      
      // New page for pie chart
      doc.addPage();
      doc.y = 50;
      
      // Pie chart
      console.log(`  📊 Generating expense pie chart...`);
      const pieChart = await renderExpensePieChart(summaries, client.name);
      
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Expense Breakdown by Category')
        .moveDown(0.5);
      
      doc.image(pieChart, 50, doc.y, { width: 512 });
      doc.y += 380;
      
      // Category details table
      doc.moveDown();
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Category Details')
        .moveDown(0.5);
      
      // Aggregate category totals
      const categoryTotals = {};
      summaries.forEach(s => {
        if (!s.cashFlow) return;
        Object.keys(CATEGORY_LABELS).forEach(cat => {
          const amount = s.cashFlow[cat] || 0;
          if (amount > 0) {
            categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
          }
        });
      });
      
      const sortedCategories = Object.entries(categoryTotals)
        .filter(([_, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1]);
      
      doc.fontSize(10).font('Helvetica');
      
      sortedCategories.forEach(([cat, amount]) => {
        const pct = totalExpenses > 0 ? ((amount / totalExpenses) * 100).toFixed(1) : 0;
        const monthlyAvg = (amount / summaries.length).toFixed(2);
        doc.text(`${CATEGORY_LABELS[cat] || cat}: $${amount.toLocaleString()} (${pct}%) - Avg: $${monthlyAvg}/month`);
      });
      
      // Add page numbers
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .fillColor('#666')
          .text(
            `Bautista Planning and Analytics | Page ${i + 1} of ${pages.count}`,
            50,
            742,
            { align: 'center', width: 512 }
          );
      }
      
      doc.end();
      
      writeStream.on('finish', () => resolve(outputPath));
      writeStream.on('error', reject);
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Client Report Generator');
  console.log('='.repeat(50));
  
  // Initialize database
  await initDatabase();
  
  // Create output directory
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }
  
  console.log(`📁 Output directory: ${path.resolve(CONFIG.outputDir)}`);
  console.log(`📅 Months to include: ${CONFIG.months}`);
  console.log('');
  
  // Get clients
  let clients;
  if (CONFIG.clientId) {
    const supabase = getDatabase();
    const { data } = await supabase
      .from('clients')
      .select('client_id, name, email')
      .eq('client_id', CONFIG.clientId)
      .single();
    
    clients = data ? [{
      clientId: data.client_id,
      name: data.name,
      email: data.email
    }] : [];
    
    if (clients.length === 0) {
      console.error(`❌ Client not found: ${CONFIG.clientId}`);
      process.exit(1);
    }
  } else {
    clients = await getAllClients();
  }
  
  console.log(`👥 Found ${clients.length} client(s)`);
  console.log('');
  
  // Generate reports
  const generated = [];
  const failed = [];
  
  for (const client of clients) {
    console.log(`📄 Generating report for: ${client.name}`);
    
    try {
      // Fetch summaries
      const summaries = await getClientSummaries(client.clientId, CONFIG.months);
      console.log(`  📊 Found ${summaries.length} monthly summaries`);
      
      // Generate filename
      const safeName = client.name.replace(/[^a-zA-Z0-9]/g, '_');
      const timestamp = moment().format('YYYY-MM-DD');
      const filename = `${safeName}_Financial_Report_${timestamp}.pdf`;
      const outputPath = path.join(CONFIG.outputDir, filename);
      
      // Generate PDF
      await generateClientPDF(client, summaries, outputPath);
      
      console.log(`  ✅ Saved: ${filename}`);
      generated.push({ client: client.name, path: outputPath });
      
    } catch (error) {
      console.error(`  ❌ Failed: ${error.message}`);
      failed.push({ client: client.name, error: error.message });
    }
    
    console.log('');
  }
  
  // Summary
  console.log('='.repeat(50));
  console.log('📊 SUMMARY');
  console.log(`  ✅ Generated: ${generated.length} report(s)`);
  console.log(`  ❌ Failed: ${failed.length} report(s)`);
  
  if (generated.length > 0) {
    console.log('');
    console.log('📁 Generated files:');
    generated.forEach(g => console.log(`   ${g.path}`));
  }
  
  if (failed.length > 0) {
    console.log('');
    console.log('❌ Failed reports:');
    failed.forEach(f => console.log(`   ${f.client}: ${f.error}`));
  }
  
  process.exit(failed.length > 0 ? 1 : 0);
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
