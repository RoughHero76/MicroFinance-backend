const RepaymentSchedule = require('../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const Penalty = require('../models/Customers/Loans/Repayment/PenaltyModel');


const pendingToOverdue = async () => {

    let today = new Date();
    const repaymentSchedules = await RepaymentSchedule.find({ status: 'Pending', dueDate: { $lte: today } });
    if (repaymentSchedules.length > 0) {
        for (const repaymentSchedule of repaymentSchedules) {
            await createPenalty(repaymentSchedule);
        }
    }
}

const createPenalty = async (repaymentSchedule) => {
    if (repaymentSchedule.penalty) {
        console.log("Penalty already exists for repayment schedule:", repaymentSchedule._id);
        return;
    } else {
        const newPenalty = new Penalty({
            loan: repaymentSchedule.loan,
            repaymentSchedule: repaymentSchedule._id,
            amount: repaymentSchedule.originalAmount * 0.1, // 10% penalty
            reason: "Overdue Payment [Auto Generated]",
            appliedDate: new Date()
        })

        await newPenalty.save();

        repaymentSchedule.penalty = newPenalty._id;
        repaymentSchedule.penaltyApplied = true;
        repaymentSchedule.status = "Overdue";
        return repaymentSchedule.save();
    }
}


module.exports = {
    pendingToOverdue
}