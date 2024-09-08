document.addEventListener("DOMContentLoaded", function () {
    // Fetch the data from installments.json
    fetch('installments.json')
        .then(response => response.json())
        .then(data => {
            // Update loan summary details
            document.getElementById('outstanding-amount').textContent = `${data.outstandingAmount}`;
            document.getElementById('total-repayment-amount').textContent = `${data.totalRepaymentAmount}`;
            document.getElementById('number-of-installments').textContent = data.numberOfInstallments;
            document.getElementById('loan-end-date').textContent = new Date(data.loanEndDate).toLocaleDateString();

            // Render the upcoming installments
            const installmentsContainer = document.getElementById('installments');
            data.schedule.forEach(installment => {
                const installmentDiv = document.createElement('div');
                installmentDiv.className = 'installment';

                installmentDiv.innerHTML = `
                        <p><strong>Due Date:</strong> ${new Date(installment.dueDate).toLocaleDateString()}</p>
                        <p><strong>Amount:</strong> ${installment.amount}</p>
                        <p><strong>Status:</strong> ${installment.status}</p>
                    `;
                installmentsContainer.appendChild(installmentDiv);
            });
        })
        .catch(error => console.error('Error fetching the installments data:', error));
});
