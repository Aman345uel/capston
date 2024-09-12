require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');//to connect and execute on mysql
const app = express();
const cors = require('cors');//allowing requests from different origins
app.use(cors()); 

app.set('view engine', 'ejs');//ejs as the templete engine
app.use(express.urlencoded({ extended: true })); //to pass it to req.body
app.use(express.json()); //josn to req.body

const reportDb = mysql.createConnection({
    host: process.env.DB_REPORT_HOST,
    user: process.env.DB_REPORT_USER,
    password: process.env.DB_REPORT_PASSWORD,
    database: process.env.DB_REPORT_NAME
});

const salesDb = mysql.createConnection({
    host: process.env.DB_SALES_HOST,
    user: process.env.DB_SALES_USER,
    password: process.env.DB_SALES_PASSWORD,
    database: process.env.DB_SALES_NAME
});

reportDb.connect((err) => {
    if (err) {
        console.error('Error connecting to the report database:', err);
    } else {
        console.log('Connected to the report database!');
    }
});

salesDb.connect((err) => {
    if (err) {
        console.error('Error connecting to the sales database:', err);
    } else {
        console.log('Connected to the sales database!');
    }
});

app.get('/', async (req, res) => {
    try {
        const [sales] = await salesDb.promise().query('SELECT * FROM sales ORDER BY sales_id ASC');
        const [reports] = await reportDb.promise().query('SELECT * FROM report ORDER BY report_id ASC');
        res.render('index', { 
            sales, 
            report: reports, 
            title: 'Sales and Reports' 
        });
    } catch (error) {
        console.error('Error fetching sales and reports data:', error.message);
        res.render('error', { message: 'Error fetching data', error });
    }
});


app.get('/api/sales', async (req, res) => {
    try {
        const [sales] = await salesDb.promise().query('SELECT * FROM sales ORDER BY sales_id ASC');
        res.json(sales);
    } catch (error) {
        console.error('Error fetching sales data:', error.message);
        res.status(500).json({ error: 'Error fetching sales data' });
    }
});//sales daya as a json  

app.get('/api/sales/reports', async (req, res) => {
    try {
        const [reports] = await reportDb.promise().query('SELECT * FROM report ORDER BY report_id ASC');
        res.json(reports);
    } catch (error) {
        console.error('Error fetching sales reports:', error.message);
        res.status(500).json({ error: 'Error fetching sales reports' });
    }
});


app.post('/api/sales/custom', async (req, res) => {
    const { start_date, end_date } = req.body;
    if (!start_date || !end_date) {
        return res.status(400).json({ error: 'Start date and end date are required' });
    }
    try {
        const [existingReport] = await reportDb.promise().query(`
            SELECT * FROM report WHERE start_date = ? AND end_date = ?
        `, [start_date, end_date]);
        if (existingReport.length > 0) {
            const [allReports] = await reportDb.promise().query('SELECT * FROM report ORDER BY report_id ASC');
            return res.render('index', { report: allReports, sales: await salesDb.promise().query('SELECT * FROM sales ORDER BY sales_id ASC'), title: 'Sales Reports' });
        }
        const [newReportData] = await salesDb.promise().query(`
            SELECT 
                IFNULL(SUM(total_amount), 0) AS total_sales,
                (SELECT product_name FROM sales WHERE sales_date BETWEEN ? AND ? GROUP BY product_name ORDER BY SUM(total_amount) DESC LIMIT 1) AS top_product,
                (SELECT customer_name FROM sales WHERE sales_date BETWEEN ? AND ? GROUP BY customer_name ORDER BY SUM(total_amount) DESC LIMIT 1) AS top_customer
            FROM sales
            WHERE sales_date BETWEEN ? AND ? AND status = 'complete'
        `, [start_date, end_date, start_date, end_date, start_date, end_date]);

        const newReport = {
            start_date,
            end_date,
            total_sales: newReportData[0].total_sales || 0,
            top_product: newReportData[0].top_product || 'N/A',
            top_customer: newReportData[0].top_customer || 'N/A'
        };

        await reportDb.promise().query(`
            INSERT INTO report (start_date, end_date, total_sales, top_product, top_customer) 
            VALUES (?, ?, ?, ?, ?)
        `, [start_date, end_date, newReport.total_sales, newReport.top_product, newReport.top_customer]);

        const [allReports] = await reportDb.promise().query('SELECT * FROM report ORDER BY report_id ASC');
        res.render('index', { report: allReports, sales: await salesDb.promise().query('SELECT * FROM sales ORDER BY sales_id ASC'), title: 'Sales Reports' });
    } catch (error) {
        console.error('Error generating report:', error.message);
        res.status(500).render('error', { message: 'Error generating sales report', error });
    }
});

app.post('/api/sales/delete/:report_id', async (req, res) => {
    const { report_id } = req.params;

    try {
        await reportDb.promise().query('DELETE FROM report WHERE report_id = ?', [report_id]);
        const [allReports] = await reportDb.promise().query('SELECT * FROM report ORDER BY start_date DESC');
        res.render('index', { report: allReports, sales: await salesDb.promise().query('SELECT * FROM sales ORDER BY sales_id ASC'), title: 'Sales Reports' });
    } catch (error) {
        console.error('Error deleting sales report:', error.message);
        res.status(500).render('error', { message: 'Error deleting sales report', error });
    }
});

app.get('/api/sales/trends', async (req, res) => {
    try {
        const [trends] = await salesDb.promise().query(`
            SELECT 
                DATE_FORMAT(sales_date, '%Y-%m') AS period,
                SUM(total_amount) AS total_sales
            FROM sales
            WHERE status = 'complete'
            GROUP BY period
            ORDER BY period ASC
        `);
        res.json(trends);
    } catch (error) {
        console.error('Error fetching sales trends:', error.message);
        res.status(500).json({ error: 'Error fetching sales trends' });
    }
});

app.get('/api/sales/projections', async (req, res) => {
    try {
        const [historicalData] = await salesDb.promise().query(`
            SELECT 
                YEAR(sales_date) AS year,
                MONTH(sales_date) AS month,
                SUM(total_amount) AS total_sales
            FROM sales
            WHERE status = 'complete'
            GROUP BY year, month
            ORDER BY year, month
        `);

        const projections = [];
        let lastEntry = historicalData[historicalData.length - 1];
        let lastYear = lastEntry.year;
        let lastMonth = lastEntry.month;
        let lastRevenue = lastEntry.total_sales;  

        let growthRates = [];
        for (let i = 1; i < historicalData.length; i++) {
            let previous = historicalData[i - 1];
            let current = historicalData[i];
            let growthRate = current.total_sales / previous.total_sales;
            growthRates.push(growthRate);
        }

        const averageGrowthRate = growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length;

        for (let i = 0; i < 5; i++) {
            lastMonth += 1;
            if (lastMonth > 12) {
                lastMonth = 1;
                lastYear += 1;
            }

            lastRevenue *= averageGrowthRate;

            projections.push({
                period: `${lastYear}-${String(lastMonth).padStart(2, '0')}`,
                projected_revenue: lastRevenue  
            });
        }

        res.json(projections);
    } catch (error) {
        console.error('Error fetching sales projections:', error.message);
        res.status(500).json({ error: 'Error fetching sales projections' });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

