const Loan = require('../models/Customers/Loans/LoanModel');

const outstandingAmountChecks = async () => {
    console.log('Checking outstanding amounts...');

    let wrongOutstandingAmountLoans = 0;

    // Find all active loans
    const outstandingAmountChecks = await Loan.find({ status: 'Active' });

    if (outstandingAmountChecks.length > 0) {
        console.log('Outstanding amount checks found:', outstandingAmountChecks.length);

        for (const loan of outstandingAmountChecks) {
            const correctOutstandingAmount = loan.loanAmount - loan.totalPaid;

            // If the outstanding amount is incorrect, update it
            if (loan.outstandingAmount !== correctOutstandingAmount) {
                wrongOutstandingAmountLoans++;

                // Log the loan number or ID that is incorrect
                // console.log(`Incorrect outstanding amount for Loan ID: ${loan._id}, fixing...`);

                // Update the outstandingAmount field with the correct value
                //loan.outstandingAmount = correctOutstandingAmount;

                // Save the loan with the correct outstanding amount
                //await loan.save();
            }
        }

    } else {
        console.log('No active loans found.');
    }

    console.log('Wrong outstanding amount loans found and fixed:', wrongOutstandingAmountLoans);
};

module.exports = { outstandingAmountChecks };
