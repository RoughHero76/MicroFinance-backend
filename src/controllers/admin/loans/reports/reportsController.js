const Loan = require('../../../../models/Customers/Loans/LoanModel');
const Repayment = require('../../../../models/Customers/Loans/Repayment/Repayments');
const RepaymentSchedule = require('../../../../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const Penalty = require('../../../../models/Customers/Loans/Repayment/PenaltyModel');
const Customer = require('../../../../models/Customers/profile/CustomerModel');
const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

async function fetchLoanData(startOfDay, endOfDay) {
    const repaymentSchedules = await RepaymentSchedule.find({
        dueDate: { $gte: startOfDay, $lte: endOfDay }
    }).populate({
        path: 'loan',
        match: { status: 'Active' },
        populate: {
            path: 'customer',
            model: Customer
        }
    });

    const loanData = [];

    for (const schedule of repaymentSchedules) {
        if (!schedule.loan || !schedule.loan.customer) continue; // Skip if loan is not active or customer is not found

        const repayments = await Repayment.find({ repaymentSchedule: schedule._id });
        const penalty = await Penalty.findOne({ repaymentSchedule: schedule._id });

        const paidAmount = repayments.reduce((sum, repayment) => sum + repayment.amount, 0);

        loanData.push({
            loanNumber: schedule.loan.loanNumber,
            customerName: `${schedule.loan.customer.fname} ${schedule.loan.customer.lname}`,
            phoneNumber: schedule.loan.customer.phoneNumber,
            loanAmount: schedule.loan.loanAmount,
            installmentAmount: schedule.originalAmount,
            paidAmount: paidAmount || '',
            penaltyAmount: penalty ? penalty.amount : ''
        });
    }

    return loanData;
}
async function generateExcelReport(req, res, startOfDay, endOfDay) {
    const loanData = await fetchLoanData(startOfDay, endOfDay);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Daily Loan Report');

    // ** Define column widths and ensure proper number types for loanNumber and phoneNumber **
    worksheet.columns = [
        { header: '', key: 'loanNumber', width: 15 },
        { header: '', key: 'customerName', width: 30 },
        { header: '', key: 'phoneNumber', width: 15 },
        { header: '', key: 'loanAmount', width: 15 },
        { header: '', key: 'installmentAmount', width: 15 },
        { header: '', key: 'paidAmount', width: 15 },
        { header: '', key: 'penaltyAmount', width: 15 }
    ];

    // ** Merge cells for the logo background (A1 to G4) **
    worksheet.mergeCells('A1:G4');
    const logoCell = worksheet.getCell('A1');
    logoCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' }, // Black background for logo area
    };

    // ** Add the logo (centered in merged cells) **
    const logoId = workbook.addImage({
        filename: path.join(__dirname, '..', '..', '..', '..', '..', 'assets', 'logo', 'EviLogo.png'),
        extension: 'png',
    });

    worksheet.addImage(logoId, {
        tl: { col: 2, row: 1 }, // Position the logo in row 1
        ext: { width: 220, height: 37 }, // Adjust the width and height
        editAs: 'oneCell',
    });

    // ** Add report title and date after the logo (row 5) **
    worksheet.mergeCells('A5:G5'); // Merging title row cells
    const titleCell = worksheet.getCell('A5');
    titleCell.value = `Daily Loan Report - Date: ${moment(startOfDay).format('YYYY-MM-DD')}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // ** Define headers manually after title (row 6) **
    const headerRowNumber = 6; // Headers start at row 6
    worksheet.getRow(headerRowNumber).values = [
        'A/C No', 'Customer Name', 'Phone', 'Loan Amount', 'Ins Amount', 'Paid', 'Penalty'
    ];

    // Style the header row
    const headerRow = worksheet.getRow(headerRowNumber);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }, // Light grey background for headers
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Ensure header cells have borders
    headerRow.eachCell((cell) => {
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
        };
    });

    // ** Add data rows (starting from row 7, right below headers) **
    const formattedData = loanData.map(data => ({
        loanNumber: Number(data.loanNumber), // Ensure loanNumber is stored as a number
        customerName: data.customerName,
        phoneNumber: Number(data.phoneNumber), // Ensure phoneNumber is stored as a number
        loanAmount: data.loanAmount,
        installmentAmount: data.installmentAmount,
        paidAmount: data.paidAmount,
        penaltyAmount: data.penaltyAmount
    }));

    worksheet.addRows(formattedData);

    // ** Calculate totals (based on data) **
    const totalPaid = formattedData.reduce((sum, data) => sum + (parseFloat(data.paidAmount) || 0), 0);
    const totalPenalty = formattedData.reduce((sum, data) => sum + (parseFloat(data.penaltyAmount) || 0), 0);

    // ** Add total row after the data **
    const totalRowNumber = formattedData.length + headerRowNumber + 1; // Dynamic row number for totals
    worksheet.getRow(totalRowNumber).values = ['Total', '', '', '', '', totalPaid, totalPenalty];
    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.font = { bold: true };

    // ** Add borders to all data and total rows **
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber >= headerRowNumber) { // Only add borders from the header row onwards
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
            });
        }
    });

    // ** Prepare for export **
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=loan_report_${moment().format('YYYY-MM-DD')}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
}


function analyzeData(loanData) {
    const totalLoans = loanData.length;
    const totalLoanAmount = loanData.reduce((sum, loan) => sum + loan.loanAmount, 0);
    const totalInstallmentAmount = loanData.reduce((sum, loan) => sum + loan.installmentAmount, 0);
    const totalPaidAmount = loanData.reduce((sum, loan) => sum + (parseFloat(loan.paidAmount) || 0), 0);
    const totalPenaltyAmount = loanData.reduce((sum, loan) => sum + (parseFloat(loan.penaltyAmount) || 0), 0);

    const loanAmountDistribution = {};
    loanData.forEach(loan => {
        const range = Math.floor(loan.loanAmount / 10000) * 10000;
        loanAmountDistribution[range] = (loanAmountDistribution[range] || 0) + 1;
    });

    const installmentAmountDistribution = {};
    loanData.forEach(loan => {
        const range = Math.floor(loan.installmentAmount / 100) * 100;
        installmentAmountDistribution[range] = (installmentAmountDistribution[range] || 0) + 1;
    });

    return {
        summary: {
            totalLoans,
            totalLoanAmount,
            averageLoanAmount: totalLoanAmount / totalLoans,
            totalInstallmentAmount,
            averageInstallmentAmount: totalInstallmentAmount / totalLoans,
            totalPaidAmount,
            totalPenaltyAmount,
        },
        distributions: {
            loanAmountDistribution,
            installmentAmountDistribution,
        },
        graphData: {
            loanAmounts: Object.entries(loanAmountDistribution).map(([range, count]) => ({
                range: `${range}-${parseInt(range) + 9999}`,
                count
            })),
            installmentAmounts: Object.entries(installmentAmountDistribution).map(([range, count]) => ({
                range: `${range}-${parseInt(range) + 99}`,
                count
            })),
        }
    };
}

exports.generateReport = async (req, res) => {
    try {
        const { type, startDate, endDate, format } = req.query;

        //Log if a request comes
        const request = {
            type,
            startDate,
            endDate,
            format
        };
        console.log('request', request);

        if (!type && format !== 'raw') {
            return res.status(400).json({
                status: 400,
                message: 'Report type must be provided unless requesting raw data'
            });
        }

        if (type && type !== 'pdf' && type !== 'xlsx' && format !== 'raw') {
            return res.status(400).json({
                status: 400,
                message: 'Report type can either be pdf, xlsx, or use raw format'
            });
        }

        let startOfDay, endOfDay;

        if (startDate && endDate) {
            startOfDay = moment.tz(startDate, 'YYYY-MM-DD', 'Asia/Kolkata').startOf('day').toDate();
            endOfDay = moment.tz(endDate, 'YYYY-MM-DD', 'Asia/Kolkata').endOf('day').toDate();
        } else {
            startOfDay = moment().tz('Asia/Kolkata').startOf('day').toDate();
            endOfDay = moment().tz('Asia/Kolkata').endOf('day').toDate();
        }

        const loanData = await fetchLoanData(startOfDay, endOfDay);
        const analysis = analyzeData(loanData);

        if (format === 'raw') {
            return res.json({
                status: 200,
                rawData: loanData,
                analysis: analysis,
                startDate: startOfDay,
                endDate: endOfDay
            });
        }

        if (type === 'pdf') {
            await generatePdfReport(req, res, startOfDay, endOfDay, loanData, analysis);
        }

        if (type === 'xlsx') {
            await generateExcelReport(req, res, startOfDay, endOfDay, loanData, analysis);
        }

    } catch (error) {
        return res.status(400).json({
            status: 400,
            message: error.message
        });
    }
};

/* 

Newer

async function generatePdfReport(req, res, startOfDay, endOfDay) {
    const loanData = await fetchLoanData(startOfDay, endOfDay);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=loan_report_${moment().format('YYYY-MM-DD')}.pdf`);
    doc.pipe(res);

    // Add logo with black background
    doc.rect(0, 0, doc.page.width, 100).fill('black');
    const logoPath = path.join(__dirname, '..', '..', '..', '..', '..', 'assets', 'logo', 'EviLogo.png');
    doc.image(logoPath, 50, 10, { 
        width: 220, // Approximately 7.79cm
        height: 37  // Approximately 1.32cm
    });

    // Add report title and date
    doc.fontSize(16).fillColor('white').text('Daily Loan Report', 300, 30);
    doc.fontSize(12).text(`Date: ${moment(startOfDay).format('YYYY-MM-DD')}`, 300, 50);

    // Move to next section
    doc.moveDown(2);

    const tableTop = 150;
    const tableLeft = 50;
    const colWidths = [60, 100, 70, 70, 70, 60, 60];

    // Table headers
    const headers = ['A/C No', 'Customer Name', 'Phone', 'Loan Amount', 'Ins Amount', 'Paid', 'Penalty'];
    doc.fillColor('black').fontSize(10);
    
    // Draw table grid
    doc.lineWidth(1);
    doc.rect(tableLeft, tableTop, doc.page.width - 100, (loanData.length + 2) * 20).stroke();
    
    headers.forEach((header, i) => {
        doc.rect(tableLeft + colWidths.slice(0, i).reduce((sum, w) => sum + w, 0), tableTop, colWidths[i], 20).stroke();
        doc.text(header, tableLeft + colWidths.slice(0, i).reduce((sum, w) => sum + w, 0) + 5, tableTop + 5);
    });

    // Table rows
    let yPos = tableTop + 20;
    let totalPaid = 0;
    let totalPenalty = 0;

    loanData.forEach((data, index) => {
        if (yPos > 700) {
            doc.addPage();
            yPos = 50;
        }

        Object.values(data).forEach((value, i) => {
            doc.rect(tableLeft + colWidths.slice(0, i).reduce((sum, w) => sum + w, 0), yPos, colWidths[i], 20).stroke();
            doc.text(value.toString(), tableLeft + colWidths.slice(0, i).reduce((sum, w) => sum + w, 0) + 5, yPos + 5);
        });

        totalPaid += parseFloat(data.paidAmount) || 0;
        totalPenalty += parseFloat(data.penaltyAmount) || 0;

        yPos += 20;
    });

    // Total row
    doc.font('Helvetica-Bold');
    doc.rect(tableLeft, yPos, doc.page.width - 100, 20).stroke();
    doc.text('Total', tableLeft + 5, yPos + 5);
    doc.text(totalPaid.toFixed(2), tableLeft + colWidths.slice(0, 5).reduce((sum, w) => sum + w, 0) + 5, yPos + 5);
    doc.text(totalPenalty.toFixed(2), tableLeft + colWidths.slice(0, 6).reduce((sum, w) => sum + w, 0) + 5, yPos + 5);

    doc.end();
}

async function generateExcelReport(req, res, startOfDay, endOfDay) {
    const loanData = await fetchLoanData(startOfDay, endOfDay);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Daily Loan Report');

    // Add logo with black background
    const logoId = workbook.addImage({
        filename: path.join(__dirname, '..', '..', '..', '..', '..', 'assets', 'logo', 'EviLogo.png'),
        extension: 'png',
    });

    // Set row heights
    worksheet.getRow(1).height = 25;
    worksheet.getRow(2).height = 25;
    worksheet.getRow(3).height = 25;

    // Merge cells for logo background
    worksheet.mergeCells('A1:G3');
    const logoCell = worksheet.getCell('A1');
    logoCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' }
    };

    // Add logo
    worksheet.addImage(logoId, {
        tl: { col: 0, row: 0 },
        ext: { width: 220, height: 37 },
        editAs: 'oneCell'
    });

    // Add report title and date
    worksheet.mergeCells('A4:G4');
    const titleCell = worksheet.getCell('A4');
    titleCell.value = `Daily Loan Report - Date: ${moment(startOfDay).format('YYYY-MM-DD')}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Empty row
    worksheet.getRow(5).height = 20;

    // Set up columns
    worksheet.columns = [
        { header: 'A/C No', key: 'loanNumber', width: 15 },
        { header: 'Customer Name', key: 'customerName', width: 20 },
        { header: 'Phone', key: 'phoneNumber', width: 15 },
        { header: 'Loan Amount', key: 'loanAmount', width: 15 },
        { header: 'Ins Amount', key: 'installmentAmount', width: 15 },
        { header: 'Paid', key: 'paidAmount', width: 15 },
        { header: 'Penalty', key: 'penaltyAmount', width: 15 }
    ];

    // Style the header row
    const headerRow = worksheet.getRow(6);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Add data rows
    worksheet.addRows(loanData);

    // Calculate totals
    const totalPaid = loanData.reduce((sum, data) => sum + (parseFloat(data.paidAmount) || 0), 0);
    const totalPenalty = loanData.reduce((sum, data) => sum + (parseFloat(data.penaltyAmount) || 0), 0);

    // Add total row
    const totalRow = worksheet.addRow({
        customerName: 'Total',
        paidAmount: totalPaid,
        penaltyAmount: totalPenalty
    });
    totalRow.font = { bold: true };

    // Add borders to all cells
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber >= 6) {  // Only add borders from the header row onwards
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=loan_report_${moment().format('YYYY-MM-DD')}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
}

exports.generateReport = async (req, res) => {
    try {
        const startOfDay = moment().tz('Asia/Kolkata').startOf('day').toDate();
        const endOfDay = moment().tz('Asia/Kolkata').endOf('day').toDate();
        const { type } = req.query;

        if (!type) {
            return res.status(400).json({
                status: 400,
                message: 'Report type must be provided'
            });
        }

        if (type !== 'pdf' && type !== 'excel') {
            return res.status(400).json({
                status: 400,
                message: 'Report type can either be pdf or excel'
            });
        }

        if (type === 'pdf') {
            await generatePdfReport(req, res, startOfDay, endOfDay);
        }

        if (type === 'excel') {
            await generateExcelReport(req, res, startOfDay, endOfDay);
        }

    } catch (error) {
        return res.status(500).json({
            status: 500,
            message: error.message
        });
    }
};

*/