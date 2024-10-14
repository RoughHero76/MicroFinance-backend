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

