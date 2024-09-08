const { generateRepaymentSchedule } = require('../helpers/loan');
const fs = require('fs');

const loan = {
    loanAmount: 25000,
    loanStartDate: new Date('2024-08-03'),
    loanDuration: '120 days',
    installmentFrequency: 'Monthly',
    gracePeriod: 30
};

try {
    const repaymentSchedule = generateRepaymentSchedule(loan);
    console.log(repaymentSchedule);
    const installments = JSON.stringify(repaymentSchedule);

    fs.writeFile('installments.json', installments, 'utf8', (err) => {
        if (err) {
            console.error('Error writing to file:', err);
        } else {
            console.log('Repayment schedule written to installments.json');
        }
    });

} catch (error) {
    console.error('Error generating repayment schedule:', error.message);
}
