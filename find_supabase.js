const dns = require('dns');

const base = 'eyfnbenaeqjbmqcspjor';
const variations = [
    base,
    base.replace('f', 'i'),
    base.replace('f', 'l'),
    base.replace('m', 'rn'),
    base.replace('q', 'g'),
    'eyfnbenaeqjbmqcspjor'.replace('q', '9'),
    'eyfnbenaeqjbmqcspjor'.replace('j', 'i'),
];

variations.forEach(v => {
    const domain = `${v}.supabase.co`;
    dns.resolve(domain, (err, addresses) => {
        if (!err) {
            console.log(`✅ FOUND: ${domain} -> ${addresses}`);
        } else {
            console.log(`❌ FAIL: ${domain} (${err.code})`);
        }
    });
});
