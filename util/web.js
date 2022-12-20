const express = require('express');
const path = require("path");
const app = express();
let Database = require('./database.js');

const db = new Database('Calls');

/**
 * Returns a number with two digits
 * @param n The number to ensure is two digits
 * @returns {*|string} The two-digit number
 */
function addLeadingZeros(n) {
    if (n <= 9) {
        return "0" + n;
    }
    return n
}

// Use the pug rendering engine
app.set('view engine', 'pug')

// The port to run the webserver on.
port = 47092;

/**
 * The front page of the site
 */
app.get('/', (req, res) => {
    res.render('index', { title: 'Home Page' });
})

/**
 * The AJAX endpoint to get contact data in JSON
 */
app.get('/contacts.json', (req, res) => {
    let contactsFromDatabase = db.query(`
        SELECT * FROM contacts ORDER BY id DESC;
    `);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(contactsFromDatabase));
})

/**
 * The AJAX endpoint to get all contact data in JSON
 */
app.get('/contacts/', (req, res) => {
    let counted = db.query(`
        SELECT * FROM contacts ORDER BY timestamp ASC;
    `);

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(counted));
})

/**
 * The AJAX endpoint to get all contact data in JSON
 */
app.get('/contacts/:previousDays', (req, res) => {
    let numDays = req.params.previousDays
    switch (numDays) {
        case "week":
            numDays = 7;
            break;
        case "month":
            numDays = 30;
            break;
        case "year":
            numDays = 365;
            break
    }
    let afterTime = new Date();
    afterTime.setDate(afterTime.getDate() - numDays);

    let counted = db.query(`
        SELECT * from contacts where timestamp >= date('${afterTime.getFullYear() + "-" + addLeadingZeros(afterTime.getMonth() + 1) + "-" + addLeadingZeros(afterTime.getDate())}') ORDER BY timestamp DESC;
    `);

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(counted));
})

/**
 * A page for a specific contact event
 */
app.get('/contact/:contactID', (req, res) => {
    let contactFromDatabase = db.query(`
        SELECT * FROM contacts WHERE id is ${req.params.contactID};
    `);
    res.render('contact', { title: 'Contact View', contact: contactFromDatabase[0] });
})

/**
 * Give access to all files in the `public` folder
 */
// app.use(express.static('../public'));
app.use(express.static(path.join(__dirname, '../public')));

app.listen( port, "0.0.0.0", () => console.log( `Node.js server started on port ${port}.` ) );
