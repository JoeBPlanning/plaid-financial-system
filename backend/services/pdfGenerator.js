/**
 * PDF Report Generator Service
 * Creates professional financial reports using PDFKit
 */

const PDFDocument = require('pdfkit');
const chartRenderer = require('./chartRenderer');
const chartDataService = require('./chartDataService');
const moment = require('moment');

// PDF Constants
const COLORS = {
  primary: '#667eea',
  secondary: '#764ba2',
  text: '#333333',
  lightGray: '#6c757d',
  border: '#e1e5e9'
};

const COMPANY_NAME = process.env.COMPANY_NAME || 'Bautista Planning and Analytics';

class ReportGenerator {
  constructor(clientData, reportType, reportParams) {
    this.client = clientData;
    this.reportType = reportType;
    this.params = reportParams;
    this.doc = null;
    this.pageNumber = 1;
  }

  /**
   * Generate PDF report
   * @returns {Promise<Buffer>} PDF as buffer
   */
  async generate() {
    // Create PDF document
    this.doc = new PDFDocument({
      size: 'LETTER', // 8.5" x 11"
      margins: { top: 72, bottom: 72, left: 72, right: 72 }, // 1 inch margins
      bufferPages: true
    });

    // Collect PDF chunks
    const chunks = [];
    this.doc.on('data', chunk => chunks.push(chunk));

    // Generate report based on type
    switch (this.reportType) {
      case 'monthly_cash_flow':
        await this._generateMonthlyCashFlowReport();
        break;
      case 'net_worth':
        await this._generateNetWorthReport();
        break;
      case 'annual_summary':
        await this._generateAnnualSummaryReport();
        break;
      case 'retirement_projection':
        await this._generateRetirementProjectionReport();
        break;
      default:
        throw new Error(`Unknown report type: ${this.reportType}`);
    }

    // Add page numbers to all pages
    const pages = this.doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      this.doc.switchToPage(i);
      this._addFooter(i + 1, pages.count);
    }

    // Finalize PDF
    this.doc.end();

    // Return as Buffer
    return new Promise((resolve, reject) => {
      this.doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.doc.on('error', reject);
    });
  }

  /**
   * Add header to page
   */
  _addHeader(title, subtitle = null) {
    // Purple gradient background (simulated with solid color)
    this.doc
      .rect(0, 0, 612, 90) // Full width
      .fill(COLORS.primary);

    // Title
    this.doc
      .fillColor('white')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text(title, 72, 25, { align: 'center', width: 468 });

    // Client name
    this.doc
      .fontSize(12)
      .font('Helvetica')
      .text(this.client.name, 72, 55, { align: 'center', width: 468 });

    // Subtitle (if provided)
    if (subtitle) {
      this.doc
        .fontSize(10)
        .text(subtitle, 72, 70, { align: 'center', width: 468 });
    }

    // Reset to black text and move down
    this.doc.fillColor(COLORS.text);
    this.doc.y = 110;
  }

  /**
   * Add footer to page
   */
  _addFooter(pageNum, totalPages) {
    const bottomY = 792 - 50; // Letter height - footer space

    this.doc
      .fontSize(8)
      .fillColor(COLORS.lightGray)
      .font('Helvetica')
      .text(
        `${COMPANY_NAME} | Page ${pageNum} of ${totalPages} | Generated ${new Date().toLocaleDateString()}`,
        72,
        bottomY,
        { align: 'center', width: 468 }
      );
  }

  /**
   * Add chart image to PDF
   */
  async _addChart(chartBuffer, title, options = {}) {
    const {
      width = 450,
      height = 225,
      x = null,
      y = null
    } = options;

    const xPos = x || 72;
    const yPos = y || this.doc.y;

    // Check if we need a new page
    if (yPos + height + 50 > 720) {
      this.doc.addPage();
      this.doc.y = 72;
    }

    // Add title
    if (title) {
      this.doc
        .fontSize(14)
        .fillColor(COLORS.text)
        .font('Helvetica-Bold')
        .text(title, xPos, this.doc.y);

      this.doc.moveDown(0.5);
    }

    // Add chart image
    const imageY = this.doc.y;
    this.doc.image(chartBuffer, xPos, imageY, { width, height });

    // Move cursor below image
    this.doc.y = imageY + height + 20;
  }

  /**
   * Add a data table
   */
  _addTable(data, columns, title = null) {
    const tableTop = this.doc.y;
    const colWidth = 468 / columns.length;

    // Add title if provided
    if (title) {
      this.doc
        .fontSize(14)
        .fillColor(COLORS.text)
        .font('Helvetica-Bold')
        .text(title, 72, tableTop);

      this.doc.moveDown(0.5);
    }

    const startY = this.doc.y;

    // Table headers
    this.doc
      .fontSize(10)
      .fillColor('#f8f9fa')
      .rect(72, startY, 468, 25)
      .fill();

    this.doc.fillColor(COLORS.text).font('Helvetica-Bold');

    columns.forEach((col, i) => {
      this.doc.text(
        col,
        72 + (i * colWidth),
        startY + 8,
        { width: colWidth, align: i === 0 ? 'left' : 'right' }
      );
    });

    this.doc.y = startY + 30;
    this.doc.font('Helvetica');

    // Table rows
    data.forEach((row, rowIdx) => {
      const rowY = this.doc.y;

      // Alternate row colors
      if (rowIdx % 2 === 0) {
        this.doc
          .fillColor('#f7f7f7')
          .rect(72, rowY - 2, 468, 20)
          .fill();
      }

      this.doc.fillColor(COLORS.text).fontSize(9);

      row.forEach((cell, colIdx) => {
        this.doc.text(
          cell,
          72 + (colIdx * colWidth),
          rowY,
          { width: colWidth, align: colIdx === 0 ? 'left' : 'right' }
        );
      });

      this.doc.y = rowY + 20;
    });

    this.doc.moveDown();
  }

  /**
   * Generate Monthly Cash Flow Report
   */
  async _generateMonthlyCashFlowReport() {
    const month = this.params.month;
    const monthLabel = moment(month).format('MMMM YYYY');

    // Page 1: Header + Income vs Expenses chart
    this._addHeader('Monthly Cash Flow Report', monthLabel);

    this.doc
      .fontSize(11)
      .fillColor(COLORS.text)
      .font('Helvetica')
      .text(`This report provides a comprehensive overview of your cash flow for ${monthLabel}.`, { align: 'left' })
      .moveDown();

    // Fetch and render income vs expenses chart
    console.log('📊 Generating income vs expenses chart...');
    const incomeVsExpenses = await chartDataService.getIncomeVsExpensesChart(this.client.clientId, 12);
    const incomeChart = await chartRenderer.renderIncomeVsExpensesChart(incomeVsExpenses);

    await this._addChart(incomeChart, 'Income vs Expenses (12 Months)', {
      width: 468,
      height: 234
    });

    // Add summary metrics
    const currentMonthData = incomeVsExpenses.income[incomeVsExpenses.income.length - 1];
    const currentExpenses = incomeVsExpenses.totalExpenses[incomeVsExpenses.totalExpenses.length - 1];
    const currentDifference = incomeVsExpenses.difference[incomeVsExpenses.difference.length - 1];

    this.doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Summary for ' + monthLabel, { underline: true })
      .moveDown(0.5)
      .font('Helvetica')
      .fontSize(10)
      .text(`Total Income: $${currentMonthData.toLocaleString()}`)
      .text(`Total Expenses: $${currentExpenses.toLocaleString()}`)
      .text(`Net Cash Flow: $${currentDifference.toLocaleString()}`, {
        color: currentDifference >= 0 ? '#28a745' : '#dc3545'
      })
      .fillColor(COLORS.text)
      .moveDown();

    // Page 2: Expense Breakdown
    this.doc.addPage();
    this.doc.y = 72;

    this.doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('Expense Breakdown', { underline: true })
      .moveDown();

    // Fetch and render expense breakdown chart
    console.log('📊 Generating expense breakdown chart...');
    const startDate = moment(month).startOf('month').format('YYYY-MM-DD');
    const endDate = moment(month).endOf('month').format('YYYY-MM-DD');
    const expenseBreakdown = await chartDataService.getExpenseBreakdownChart(
      this.client.clientId,
      startDate,
      endDate
    );
    const pieChart = await chartRenderer.renderExpenseBreakdownChart(expenseBreakdown);

    await this._addChart(pieChart, null, {
      width: 468,
      height: 350
    });

    // Add category detail table
    if (expenseBreakdown.categories.length > 0) {
      const tableData = expenseBreakdown.categories.map(cat => [
        cat.name,
        `$${cat.amount.toLocaleString()}`,
        `${cat.percentage}%`
      ]);

      this._addTable(tableData, ['Category', 'Amount', 'Percentage'], 'Expense Details');
    }

    console.log('✅ Monthly Cash Flow Report generated');
  }

  /**
   * Generate Net Worth Statement
   */
  async _generateNetWorthReport() {
    this._addHeader('Net Worth Statement', moment().format('MMMM YYYY'));

    this.doc
      .fontSize(11)
      .text('This statement provides a snapshot of your current financial position.')
      .moveDown();

    // Fetch and render net worth history chart
    console.log('📊 Generating net worth history chart...');
    const netWorthData = await chartDataService.getNetWorthHistoryChart(
      this.client.clientId,
      24,
      this.params.includeSocialSecurity || false
    );
    const netWorthChart = await chartRenderer.renderNetWorthHistoryChart(netWorthData);

    await this._addChart(netWorthChart, 'Net Worth History (24 Months)', {
      width: 468,
      height: 234
    });

    // Add current net worth summary
    const latestNetWorth = netWorthData.netWorth[netWorthData.netWorth.length - 1] || 0;
    const latestAssets = netWorthData.assets[netWorthData.assets.length - 1] || 0;
    const latestLiabilities = netWorthData.liabilities[netWorthData.liabilities.length - 1] || 0;

    this.doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Current Financial Position', { underline: true })
      .moveDown(0.5)
      .font('Helvetica')
      .fontSize(10)
      .text(`Total Assets: $${latestAssets.toLocaleString()}`)
      .text(`Total Liabilities: $${latestLiabilities.toLocaleString()}`)
      .text(`Net Worth: $${latestNetWorth.toLocaleString()}`, {
        color: latestNetWorth >= 0 ? '#28a745' : '#dc3545'
      })
      .fillColor(COLORS.text)
      .moveDown();

    console.log('✅ Net Worth Statement generated');
  }

  /**
   * Generate Annual Summary Report
   */
  async _generateAnnualSummaryReport() {
    const year = this.params.year || moment().format('YYYY');

    this._addHeader('Annual Summary Report', year);

    this.doc
      .fontSize(11)
      .text(`This report summarizes your financial activity for the year ${year}.`)
      .moveDown();

    // Fetch and render annual expense trends
    console.log('📊 Generating annual expense trends chart...');
    const expensesTrend = await chartDataService.getExpensesByCategoryChart(this.client.clientId, 12);
    const expensesChart = await chartRenderer.renderExpensesByCategoryChart(expensesTrend);

    await this._addChart(expensesChart, 'Expense Trends by Category', {
      width: 468,
      height: 234
    });

    this.doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Year ' + year + ' Summary', { underline: true })
      .moveDown(0.5)
      .font('Helvetica')
      .fontSize(10)
      .text('This annual summary provides insights into your spending patterns and financial progress.')
      .moveDown();

    console.log('✅ Annual Summary Report generated');
  }

  /**
   * Generate Retirement Projection Report
   */
  async _generateRetirementProjectionReport() {
    this._addHeader('Retirement Projection Report', 'Financial Planning Analysis');

    this.doc
      .fontSize(11)
      .text('This report provides general retirement guidance based on your current financial position and Social Security benefits.')
      .moveDown();

    // Fetch net worth data with Social Security
    console.log('📊 Generating retirement projection chart...');
    const retirementData = await chartDataService.getNetWorthHistoryChart(
      this.client.clientId,
      24,
      true // Include Social Security
    );
    const retirementChart = await chartRenderer.renderNetWorthHistoryChart(retirementData);

    await this._addChart(retirementChart, 'Net Worth Projection with Social Security', {
      width: 468,
      height: 234
    });

    this.doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Retirement Readiness', { underline: true })
      .moveDown(0.5)
      .font('Helvetica')
      .fontSize(10)
      .text('Based on your current financial position and Social Security benefits, here are general recommendations for retirement planning.')
      .moveDown();

    if (retirementData.socialSecurityPV) {
      this.doc.text(`Social Security Present Value: $${retirementData.socialSecurityPV.toLocaleString()}`);
      this.doc.text('This represents the estimated lifetime value of your Social Security benefits.');
    }

    console.log('✅ Retirement Projection Report generated');
  }
}

module.exports = { ReportGenerator };
