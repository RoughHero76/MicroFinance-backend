const Customer = require('../../models/Customers/profile/CustomerModel'); // Adjust the path as needed
const Loan = require('../../models/Customers/Loans/LoanModel'); // Adjust the path as needed

exports.getDashboardData = async (req, res) => {
    try {
        // 1. Get total active loans count
        const activeLoanCount = await Loan.countDocuments({ status: 'Active' });

        // 2. Get market details
        const activeOrApprovedFilter = { status: { $in: ['Active', 'Approved'] } };
        const [totalMarketAmount, totalMarketAmountRepaid] = await Promise.all([
            Loan.aggregate([
                { $match: activeOrApprovedFilter },
                { $group: { _id: null, totalMarketAmount: { $sum: '$loanAmount' } } }
            ]),
            Loan.aggregate([
                { $match: activeOrApprovedFilter },
                { $group: { _id: null, totalMarketAmountRepaid: { $sum: '$totalPaid' } } }
            ])
        ]);

        // 3. Get total customer count
        const totalCustomers = await Customer.countDocuments();

        // 4. Get recent customers (limit to 5)
        const recentCustomers = await Customer.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate({
                path: 'loans',
                select: 'loanAmount status',
                options: { sort: { createdAt: -1 }, limit: 1 }
            });

        // Process recent customers to match the frontend needs
        const processedRecentCustomers = recentCustomers.map(customer => ({
            uid: customer.uid,
            fname: customer.fname,
            lname: customer.lname,
            loans: customer.loans.map(loan => ({
                loanAmount: loan.loanAmount,
                status: loan.status
            }))
        }));

        res.json({
            status: 'success',
            data: {
                loanCount: activeLoanCount,
                marketDetails: {
                    totalMarketAmount: totalMarketAmount[0]?.totalMarketAmount || 0,
                    totalMarketAmountRepaid: totalMarketAmountRepaid[0]?.totalMarketAmountRepaid || 0
                },
                customerCount: totalCustomers,
                recentCustomers: processedRecentCustomers
            }
        });
    } catch (error) {
        console.error('Error in getDashboardData:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};