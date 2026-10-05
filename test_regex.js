function matchesAlias(q, alias) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, 'i');
    return regex.test(q);
}

console.log(matchesAlias("i felt like buying", "lt")); // Should be false
console.log(matchesAlias("i want to buy l&t", "l&t")); // Should be true
console.log(matchesAlias("what about l&t?", "l&t")); // Should be true
console.log(matchesAlias("l&t", "l&t")); // Should be true
console.log(matchesAlias("buy itc now", "itc")); // Should be true
console.log(matchesAlias("pitch it", "itc")); // Should be false
