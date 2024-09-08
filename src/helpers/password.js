const passwordRequirements = [
    { regex: /(?=.*[a-z])/, message: "Password should contain at least one lowercase letter" },
    { regex: /(?=.*[A-Z])/, message: "Password should contain at least one uppercase letter" },
    { regex: /(?=.*\d)/, message: "Password should contain at least one digit" },
    { regex: /(?=.*[@$!%*?&])/, message: "Password should contain at least one special character (@$!%*?&)" },
    { regex: /.{8,}/, message: "Password should be at least 8 characters long" },
];

function goodPassword(password) {
    return passwordRequirements.every(req => req.regex.test(password));
}

function getPasswordErrors(password) {
    return passwordRequirements
        .filter(req => !req.regex.test(password))
        .map(req => req.message);
}



module.exports = { goodPassword, getPasswordErrors };