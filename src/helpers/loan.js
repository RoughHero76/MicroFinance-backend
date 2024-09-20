const { addDays, addWeeks, addMonths, isAfter, isBefore } = require('date-fns');

/**
 * Generates a repayment schedule for a loan.
 * @param {Object} loan - The loan object containing loan details.
 * @param {number} loan.loanAmount - The total amount of the loan.
 * @param {Date} loan.loanStartDate - The start date of the loan.
 * @param {string} loan.loanDuration - The duration of the loan (e.g., '100 days').
 * @param {string} loan.installmentFrequency - The frequency of installments ('Daily', 'Weekly', or 'Monthly').
 * @param {number} [loan.gracePeriod=0] - The grace period in days before the first installment.
 * @returns {Object} An object containing the repayment schedule and loan details.
 * @throws {Error} If invalid loan parameters are provided.
 */
function generateRepaymentSchedule(loan) {
    console.log('Generating repayment schedule with the following loan details:', loan);

    // Input validation
    if (!loan || typeof loan !== 'object') {
        throw new Error('Invalid loan object');
    }
    if (!loan.loanAmount || loan.loanAmount <= 0) {
        throw new Error('Invalid loan amount');
    }
    if (!(loan.loanStartDate instanceof Date)) {
        throw new Error('Invalid loan start date');
    }
    if (!['Daily', 'Weekly', 'Monthly'].includes(loan.installmentFrequency)) {
        throw new Error('Invalid installment frequency');
    }

    const schedule = [];
    let currentDate = new Date(loan.loanStartDate);
    const totalDays = parseInt(loan.loanDuration.split(' ')[0]);
    const endDate = addDays(currentDate, totalDays);
    let remainingAmount = loan.loanAmount;
    let numberOfInstallments;

    console.log('Initial currentDate:', currentDate);
    console.log('Total days:', totalDays);
    console.log('End date:', endDate);

    // Apply grace period
    const gracePeriod = loan.gracePeriod || 0;
    currentDate = addDays(currentDate, gracePeriod);

    console.log('Current date after applying grace period:', currentDate);
    console.log('Grace period:', gracePeriod);

    // Calculate number of installments
    switch (loan.installmentFrequency) {
        case 'Daily':
            numberOfInstallments = totalDays;
            break;
        case 'Weekly':
            numberOfInstallments = Math.ceil(totalDays / 7);
            break;
        case 'Monthly':
            numberOfInstallments = Math.ceil(totalDays / 30);
            break;
    }

    console.log('Number of installments:', numberOfInstallments);

    // Calculate installment amount (rounded to 2 decimal places)
    const installmentAmount = Math.ceil((loan.loanAmount / numberOfInstallments) * 100) / 100;

    console.log('Installment amount:', installmentAmount);

    for (let i = 0; i < numberOfInstallments; i++) {
        let amount = i === numberOfInstallments - 1 ? remainingAmount : installmentAmount;
        let dueDate = new Date(currentDate);

        // Prevent overlapping installments
        if (schedule.length > 0) {
            const lastInstallment = schedule[schedule.length - 1];
            if (isBefore(dueDate, lastInstallment.dueDate) || dueDate.getTime() === lastInstallment.dueDate.getTime()) {
                dueDate = addDays(lastInstallment.dueDate, 1);
            }
        }

        // Don't add installment if it's after the end date
        if (isAfter(dueDate, endDate)) {
            break;
        }

        schedule.push({
            dueDate: dueDate,
            amount: Math.min(amount, remainingAmount), // Ensure we don't overpay
            status: 'Pending'
        });

        //console.log(`Installment ${i + 1}: Due Date: ${dueDate}, Amount: ${Math.min(amount, remainingAmount)}`);

        remainingAmount = Math.max(0, remainingAmount - amount);

        // Move to next installment date
        switch (loan.installmentFrequency) {
            case 'Daily':
                currentDate = addDays(currentDate, 1);
                break;
            case 'Weekly':
                currentDate = addWeeks(currentDate, 1);
                break;
            case 'Monthly':
                currentDate = addMonths(currentDate, 1);
                break;
        }
    }


    // Adjust the last installment if necessary
    if (remainingAmount > 0) {
        const lastInstallment = schedule[schedule.length - 1];
        lastInstallment.amount += remainingAmount;
        lastInstallment.dueDate = new Date(Math.min(lastInstallment.dueDate, endDate));
    }

    const totalRepaymentAmount = schedule.reduce((sum, installment) => sum + installment.amount, 0);

    console.log('Total repayment amount:', totalRepaymentAmount);



    // Ensure we have at least one installment
    if (schedule.length === 0) {
        throw new Error('No valid installments generated');
    }

    return {
        schedule,
        loanEndDate: endDate,
        outstandingAmount: loan.loanAmount,
        numberOfInstallments: schedule.length,
        totalRepaymentAmount,
        repaymentAmountPerInstallment: schedule[0].amount
    };
}
module.exports = {
    generateRepaymentSchedule
};


