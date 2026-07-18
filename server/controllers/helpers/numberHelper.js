const parsePositiveInteger = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
};

module.exports = { parsePositiveInteger };
