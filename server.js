const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const app = express();
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up MySQL connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '1234',
    database: 'HRS7',
    port: 3306
});

// Connect to MySQL and handle connection errors
db.connect(err => {
    if (err) {
        console.error('Error connecting to MySQL:', err.message);
        return;
    }
    console.log('Connected to MySQL');
});

// Registration endpoint
app.post('/register', (req, res) => {
    const { user_type } = req.body;

    // Begin transaction
    db.beginTransaction(err => {
        if (err) {
            console.error('Transaction error:', err.message);
            return res.status(500).json({ error: 'Failed to start transaction' });
        }

        // Handle medical registration separately
        if (user_type === 'medical') {
            const { 
                phone, email, district, password,
                medical_name, license_number, address 
            } = req.body;

            // Validate required fields for medical
            if (!medical_name || !license_number || !phone || !email || 
                !district || !password || !address) {
                return db.rollback(() => {
                    return res.status(400).json({ 
                        error: 'Missing required fields for medical registration' 
                    });
                });
            }

            // Generate unique ID for medical using license number
            const unique_id = `M${license_number}`;

            // Insert into medical table only
            const medicalQuery = `
                INSERT INTO medical (
                    unique_id, user_type, phone, email, district, 
                    password, medical_name, license_number, address
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const medicalValues = [
                unique_id, user_type, phone, email, district,
                password, medical_name, license_number, address
            ];

            db.query(medicalQuery, medicalValues, (err, result) => {
                if (err) {
                    return db.rollback(() => {
                        if (err.code === 'ER_DUP_ENTRY') {
                            return res.status(409).json({ 
                                error: 'Medical institution with this email or license number already exists' 
                            });
                        }
                        console.error('Database insert error:', err.message);
                        return res.status(500).json({ error: 'Failed to register medical institution' });
                    });
                }

                db.commit(err => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('Commit error:', err.message);
                            return res.status(500).json({ error: 'Failed to complete registration' });
                        });
                    }
                    return res.json({ 
                        message: `Registration successful! Your ID: ${unique_id}`,
                        unique_id: unique_id 
                    });
                });
            });
        } else {
            // Handle other user types (patient, doctor, admin)
            const { 
                fullname, dob, phone, email, district, password,
                blood_group, nid, birth_certificate, medical_name, 
                license_number, specialist 
            } = req.body;

            // Validate required fields for other user types
            if (!fullname || !dob || !phone || !email || 
                !district || !password || !blood_group) {
                return db.rollback(() => {
                    return res.status(400).json({ 
                        error: 'Missing required fields' 
                    });
                });
            }

            // Validate and format the date
            let formattedDob;
            try {
                const dobDate = new Date(dob);
                if (isNaN(dobDate.getTime())) {
                    throw new Error('Invalid date');
                }
                formattedDob = dobDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
            } catch (error) {
                return db.rollback(() => {
                    return res.status(400).json({ 
                        error: 'Invalid date of birth format' 
                    });
                });
            }

            // Generate unique ID
            let unique_id;
            if (!nid && !birth_certificate) {
                unique_id = `${user_type[0].toUpperCase()}${Date.now().toString(36)}`;
            } else {
                unique_id = `${user_type[0].toUpperCase()}${nid || birth_certificate}`;
            }

            // Doctor-specific validation
            if (user_type === 'doctor' && (!medical_name || !license_number || !specialist)) {
                return db.rollback(() => {
                    return res.status(400).json({ 
                        error: 'Medical name, license number, and specialist fields are required for doctors' 
                    });
                });
            }

            // First, insert into users table
            const userQuery = `
                INSERT INTO users (
                    fullname, dob, user_type, unique_id, nid, birth_certificate, 
                    phone, email, district, password, blood_group,
                    medical_name, license_number, specialist
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const userMedicalName = user_type === 'doctor' ? medical_name : null;
            const userLicenseNumber = user_type === 'doctor' ? license_number : null;
            const userSpecialist = user_type === 'doctor' ? specialist : null;

            const userValues = [
                fullname, formattedDob, user_type, unique_id, nid || null, birth_certificate || null,
                phone, email, district, password, blood_group,
                userMedicalName, userLicenseNumber, userSpecialist
            ];

            // Insert into users table first
            db.query(userQuery, userValues, (err, result) => {
                if (err) {
                    return db.rollback(() => {
                        if (err.code === 'ER_DUP_ENTRY') {
                            return res.status(409).json({ 
                                error: 'User with this email or ID already exists' 
                            });
                        }
                        console.error('Database insert error:', err.message);
                        return res.status(500).json({ error: 'Failed to register user' });
                    });
                }

                // Prepare type-specific table insertion
                const typeSpecificQuery = user_type === 'doctor' 
                    ? `INSERT INTO doctors (
                        unique_id, fullname, dob, user_type, nid, birth_certificate,
                        phone, email, district, password, blood_group,
                        medical_name, license_number, specialist
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    : `INSERT INTO ${user_type}s (
                        unique_id, fullname, dob, user_type, nid, birth_certificate,
                        phone, email, district, password, blood_group
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                const typeSpecificValues = user_type === 'doctor'
                    ? [
                        unique_id, fullname, formattedDob, user_type, nid || null, birth_certificate || null,
                        phone, email, district, password, blood_group,
                        medical_name, license_number, specialist
                    ]
                    : [
                        unique_id, fullname, formattedDob, user_type, nid || null, birth_certificate || null,
                        phone, email, district, password, blood_group
                    ];

                // Insert into type-specific table
                db.query(typeSpecificQuery, typeSpecificValues, (err, result) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('Database insert error:', err.message);
                            return res.status(500).json({ error: 'Failed to register user' });
                        });
                    }

                    db.commit(err => {
                        if (err) {
                            return db.rollback(() => {
                                console.error('Commit error:', err.message);
                                return res.status(500).json({ error: 'Failed to complete registration' });
                            });
                        }
                        res.json({ 
                            message: `Registration successful! Your unique ID is ${unique_id}`,
                            unique_id: unique_id,
                            user_type: user_type
                        });
                    });
                });
            });
        }
    });
});

// Modified submit_patient_data endpoint
// Endpoint to fetch user details by unique ID (patient ID)
app.get('/get_user_details/:id', async (req, res) => {
    try {
        const [users] = await db.promise().query(
            'SELECT fullname, dob, district FROM users WHERE unique_id = ?',
            [req.params.id]
        );

        if (users.length > 0) {
            const dob = new Date(users[0].dob);
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const monthDiff = today.getMonth() - dob.getMonth();

            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
                age--;
            }

            res.json({ ...users[0], age });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        console.error('Database query error:', error);
        res.status(500).json({ error: 'Failed to fetch user details' });
    }
});

// Endpoint to fetch medical name by entered medical name
app.get('/get_medical_details/:id', async (req, res) => {
    try {
        const [medical] = await db.promise().query(
            'SELECT medical_name FROM medical WHERE unique_id = ?',
            [req.params.id]
        );

        if (medical.length > 0) {
            res.json(medical[0]);
        } else {
            res.status(404).json({ error: 'Medical id not found' });
        }
    } catch (error) {
        console.error('Database query error:', error);
        res.status(500).json({ error: 'Failed to fetch medical details' });
    }
});

// Endpoint to fetch doctor details by doctor ID
app.get('/get_doctor_details/:id', async (req, res) => {
    try {
        const [doctor] = await db.promise().query(
            'SELECT fullname FROM doctors WHERE unique_id = ?',
            [req.params.id]
        );

        if (doctor.length > 0) {
            // Change 'doctor_name' to 'fullname' in the response to match client expectation
            res.json({ fullname: doctor[0].fullname });
        } else {
            res.status(404).json({ error: 'Doctor not found' });
        }
    } catch (error) {
        console.error('Database query error:', error);
        res.status(500).json({ error: 'Failed to fetch doctor details' });
    }
});


// Endpoint to submit patient data
app.post('/submit_patient_data', upload.single('doctor_signature'), async (req, res) => {
    const {
        patient_id, patient_name, current_address, age, admitted_medical_id, admitted_medical_name, admitted_bed_no,
        admission_date, admission_type, discharge_date, 
        doctor_id, doctor_name, disease_name, symptoms,
        diagnosis, treatment_summary, prescriptions, 
        tests_results, follow_up, comments
    } = req.body;

    const doctor_signature = req.file ? req.file.filename : null;

    // Check if required fields are provided
    if (!patient_id || !patient_name || !doctor_id || !doctor_name) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Verify patient exists in users table and get their details
        const [userExists] = await db.promise().query(
            `SELECT dob, fullname, district FROM users WHERE unique_id = ?`,
            [patient_id]
        );

        if (!userExists.length) {
            return res.status(400).json({ error: 'Patient ID does not exist in the system.' });
        }

        // Calculate age based on DOB
        const dob = new Date(userExists[0].dob);
        const today = new Date();
        let ageCalculated = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
            ageCalculated--;
        }

        // Verify doctor exists
        const [doctorExists] = await db.promise().query(
            `SELECT user_type FROM users WHERE unique_id = ? AND user_type = 'doctor'`,
            [doctor_id]
        );

        if (!doctorExists.length) {
            return res.status(400).json({ error: 'Invalid doctor ID.' });
        }

        // Insert the patient data into patients_data table
        const query = `INSERT INTO patients_data 
            (patient_id, patient_name, current_address, age,admitted_medical_id , admitted_medical_name, admitted_bed_no,
            admission_date, admission_type, discharge_date, doctor_id, doctor_name, doctor_signature,
            disease_name, symptoms, diagnosis, treatment_summary, prescriptions,
            tests_results, follow_up, comments)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)`;

        const values = [
            patient_id, userExists[0].fullname, current_address, ageCalculated,admitted_medical_id, admitted_medical_name, admitted_bed_no,
            admission_date, admission_type, discharge_date, doctor_id, doctor_name,
            doctor_signature, disease_name, symptoms, diagnosis, treatment_summary,
            prescriptions, tests_results, follow_up, comments
        ];

        await db.promise().query(query, values);

        res.json({ 
            message: 'Patient data submitted successfully',
            patient_details: {
                name: userExists[0].fullname,
                dob: userExists[0].dob,
                age: ageCalculated,
                district: userExists[0].district
            }
        });

    } catch (err) {
        console.error('Database insert error:', err.message);
        res.status(500).json({ error: 'Failed to submit patient data', details: err.message });
    }
});

//login endpoint
//Server-side (app.js)
app.post('/login', (req, res) => {
    const { loginMethod, phone, email, nid, password } = req.body;
    let identifier = '';

    // Set the identifier based on the login method
    if (loginMethod === 'phone' && phone) {
        identifier = phone;
    } else if (loginMethod === 'email' && email) {
        identifier = email;
    } else if (loginMethod === 'nid' && nid) {
        identifier = nid;
    } else {
        return res.status(400).json({ message: 'Invalid login method or missing information.' });
    }

    // Define user tables with redirect URLs
    const tables = [
        { name: 'patients', userType: 'patient', redirectUrl: '/patient_home.html' },
        { name: 'doctors', userType: 'doctor', redirectUrl: '/admin_home.html' },
        { name: 'admins', userType: 'admin', redirectUrl: '/admin_home.html' }
    ];

    // Recursive function to check each table
    function checkTable(index) {
        if (index >= tables.length) {
            return res.status(404).json({ message: 'User not found. Please register first.' });
        }

        const table = tables[index];
        const query = `SELECT * FROM ${table.name} WHERE ${loginMethod} = ?`;

        // Query the database
        db.query(query, [identifier], (err, results) => {
            if (err) {
                console.error('Error executing query:', err.message);
                return res.status(500).json({ message: 'Internal server error.' });
            }

            // If user is found, check the password
            if (results.length > 0) {
                const user = results[0];

                if (password === user.password) {
                    // Return the user type and success message
                    return res.status(200).json({
                        message: `Login successful. You are a ${table.userType}. `,
                        userType: table.userType
                    });
                } else {
                    return res.status(401).json({ message: 'Incorrect password.' });
                }
            } else {
                // Recursively check the next table
                checkTable(index + 1);
            }
        });
    }

    // Start the check with the first table
    checkTable(0);
});

// Endpoint to fetch medical institution ID by name
app.get("/fetch_medical_id/:name", async (req, res) => {
    const { name } = req.params;

    try {
        const [result] = await db.promise().query(
            `SELECT unique_id FROM medical WHERE medical_name = ?`, [name]
        );

        if (result.length === 0) {
            return res.status(404).json({ error: "Medical institution not found" });
        }

        res.json({ medical_id: result[0].unique_id });
    } catch (error) {
        console.error("Database query error:", error);
        res.status(500).json({ error: "An error occurred while fetching the medical ID" });
    }
});

// Updated search_user endpoint
app.get("/search_user/:id", async (req, res) => {
    const { id } = req.params;

    try {
        // Convert id to uppercase to ensure case-insensitive check
        if (id.toUpperCase().startsWith("M")) {
            // Medical institution query
            const [medical] = await db.promise().query(
                `SELECT medical_name, license_number, phone, email, address, district FROM medical WHERE unique_id = ?`, [id]
            );

            if (medical.length === 0) {
                return res.status(404).json({ error: "Medical institution not found" });
            }
            const medicalInfo = medical[0];
            res.json({
                type: "medical",
                details: {
                    medical_name: medicalInfo.medical_name,
                    license_number: medicalInfo.license_number,
                    phone: medicalInfo.phone,
                    email: medicalInfo.email,
                    address: medicalInfo.address,
                    district: medicalInfo.district,
                },
            });
        } else {
            // User query
            const [user] = await db.promise().query(
                `SELECT *, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM users WHERE unique_id = ?`, [id]
            );

            if (user.length === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            const userInfo = user[0];
            let additionalDetails = {};

            if (userInfo.user_type === "doctor") {
                additionalDetails = {
                    medical_name: userInfo.medical_name,
                    license_number: userInfo.license_number,
                    specialist: userInfo.specialist,

                };
            }

            const [patientRecords] = await db.promise().query(
                `SELECT id, disease_name, symptoms, admitted_medical_id, admitted_medical_name, admitted_bed_no, doctor_id, doctor_name, 
                 DATE_FORMAT(admission_date, '%d-%m-%Y') AS admission_date,
                 DATE_FORMAT(discharge_date, '%d-%m-%Y') AS discharge_date, prescriptions AS taken_medicine
                 FROM patients_data WHERE patient_id = ?`, [id]
            );

            res.json({
                type: "user",
                userInfo: {
                    fullname: userInfo.fullname,
                    age: userInfo.age,
                    blood_group: userInfo.blood_group,
                    district: userInfo.district,
                    user_type: userInfo.user_type,
                    ...additionalDetails,
                },
                records: patientRecords.length ? patientRecords : "No medical record yet"
            });
        }
    } catch (error) {
        console.error("Database query error:", error);
        res.status(500).json({ error: "An error occurred while searching for the user" });
    }
});


// Search by blood group endpoint
app.get('/search_by_blood_group/:bloodGroup', (req, res) => {
    const bloodGroup = req.params.bloodGroup;

    const query = `
        SELECT 
    u.unique_id AS Unique_ID,
    u.fullname AS Name,
    u.blood_group AS Blood_Group,
    TIMESTAMPDIFF(YEAR, u.dob, CURDATE()) AS Age,
    u.phone AS Contact_Number,
    u.district AS District,
    (SELECT COUNT(*) 
     FROM users 
     WHERE blood_group = u.blood_group) AS Total_Same_Blood_Group
FROM 
    users u
WHERE 
    u.blood_group = ?;

    `;

    // Execute the query with the bloodGroup parameter
    db.query(query, [bloodGroup], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Database query error' });
        }
        // Send the results as JSON response
        res.json(results);
    });
});



// Helper function to determine user type from unique_id
function getUserType(uniqueId) {
    if (uniqueId.toLowerCase().startsWith('m')) {
        return 'medical';
    }
    return 'regular'; // for patients, doctors, admins
}

app.post('/verify-user', (req, res) => {
    const { uniqueId, verificationMethod, phone, email } = req.body;
    let identifier = '';
    let searchField = '';

    if (verificationMethod === 'phone' && phone) {
        identifier = phone;
        searchField = 'phone';
    } else if (verificationMethod === 'email' && email) {
        identifier = email;
        searchField = 'email';
    } else {
        return res.status(400).json({ message: 'Invalid verification method or missing information.' });
    }

    const userType = getUserType(uniqueId);
    let query;

    if (userType === 'medical') {
        // Query for medical users
        query = `SELECT * FROM medical WHERE unique_id = ? AND ${searchField} = ?`;
    } else {
        // Query for regular users (patients, doctors, admins)
        query = `SELECT * FROM users WHERE unique_id = ? AND ${searchField} = ?`;
    }

    db.query(query, [uniqueId, identifier], (err, results) => {
        if (err) {
            console.error('Error executing query:', err.message);
            return res.status(500).json({ message: 'Internal server error.' });
        }

        if (results.length > 0) {
            return res.status(200).json({
                message: 'User verified successfully.',
                verified: true,
                userType: userType
            });
        } else {
            return res.status(404).json({
                message: 'User not found or verification information incorrect.',
                verified: false
            });
        }
    });
});

app.post('/update-password', (req, res) => {
    const { uniqueId, newPassword } = req.body;
    const userType = getUserType(uniqueId);

    if (userType === 'medical') {
        // Update only medical table
        const updateQuery = 'UPDATE medical SET password = ? WHERE unique_id = ?';
        
        db.query(updateQuery, [newPassword, uniqueId], (err, result) => {
            if (err) {
                console.error('Error updating password:', err.message);
                return res.status(500).json({ message: 'Internal server error.' });
            }

            if (result.affectedRows > 0) {
                res.status(200).json({ message: 'Password updated successfully.' });
            } else {
                res.status(404).json({ message: 'Failed to update password.' });
            }
        });
    } else {
        // Update users table and respective user type table
        const updateUsersQuery = 'UPDATE users SET password = ? WHERE unique_id = ?';
        
        db.query(updateUsersQuery, [newPassword, uniqueId], (err, results) => {
            if (err) {
                console.error('Error updating password in users table:', err.message);
                return res.status(500).json({ message: 'Internal server error.' });
            }

            const tables = ['patients', 'doctors', 'admins'];
            let completedUpdates = 0;
            let success = false;

            tables.forEach(table => {
                const updateQuery = `UPDATE ${table} SET password = ? WHERE unique_id = ?`;
                
                db.query(updateQuery, [newPassword, uniqueId], (err, result) => {
                    completedUpdates++;
                    
                    if (result && result.affectedRows > 0) {
                        success = true;
                    }

                    if (completedUpdates === tables.length) {
                        if (success) {
                            res.status(200).json({ message: 'Password updated successfully.' });
                        } else {
                            res.status(404).json({ message: 'Failed to update password.' });
                        }
                    }
                });
            });
        });
    }
});

// Search by disease endpoint
app.get('/search_by_disease', (req, res) => {
    const diseaseName = req.query.disease;
    const district = req.query.district || null; // Set to null if district is not provided

    const query = `
        SELECT DISTINCT
            u.unique_id AS Unique_ID,
            u.fullname AS Name,
            pd.disease_name AS Disease_Name,
            u.district AS District,
            u.user_type AS User_Type
        FROM 
            users u
        LEFT JOIN patients p ON u.unique_id = p.unique_id
        LEFT JOIN doctors d ON u.unique_id = d.unique_id
        LEFT JOIN admins a ON u.unique_id = a.unique_id
        INNER JOIN patients_data pd ON u.unique_id = pd.patient_id
        WHERE 
            pd.disease_name = ?
            AND (u.district = ? OR ? IS NULL)
    `;

    const queryParams = [diseaseName, district, district];

    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send("Server Error");
        } else {
            res.json(results);
        }
    });
});



app.get('/search_medicals_by_district', (req, res) => {
    const district = req.query.district;

    const query = `
        SELECT 
            medical_name, 
            license_number, 
            phone, 
            address, 
            district
        FROM medical
        WHERE district = ?
    `;

    db.query(query, [district], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send("Server Error");
        } else {
            res.json(results);
        }
    });
});

app.get('/search_users_by_letter/:letter', (req, res) => {
    const letter = req.params.letter;

    // Validate input to ensure it's a single letter
    if (!/^[A-Za-z]$/.test(letter)) {
        return res.status(400).json({ error: 'Invalid input. Please enter a single letter (A-Z).' });
    }

    // SQL Query with a dynamic placeholder
    const query = `
        SELECT fullname, user_type, unique_id, phone, email, district
        FROM users
        WHERE fullname LIKE CONCAT(?, '%')
        ORDER BY fullname ASC;
    `;

    const queryParams = [letter];

    // Query the database
    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error('Query execution error:', err);
            return res.status(500).json({ error: 'Server Error' });
        }

        // Check if there are no results
        if (results.length === 0) {
            return res.status(404).json({ message: 'No users found starting with the given letter.' });
        }

        // Return the results in JSON format
        res.json(results);
    });
});


app.get('/search_doctors', (req, res) => {
    const symptoms = req.query.symptoms || '';
    const diseaseName = req.query.disease || null;

    const query = `
        SELECT DISTINCT 
            d.unique_id AS doctor_id,
            d.fullname,
            d.phone,
            d.email,
            d.medical_name
        FROM 
            doctors d
        INNER JOIN 
            patients_data pd ON d.unique_id = pd.doctor_id
        WHERE 
            pd.symptoms LIKE CONCAT('%', ?, '%')
            AND (pd.disease_name = ? OR ? IS NULL)
    `;

    const queryParams = [symptoms, diseaseName, diseaseName];

    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Server Error' });
        }
        res.json(results);
    });
});

app.get('/search_prescriptions_by_disease', (req, res) => {
    const diseaseName = req.query.disease;

    if (!diseaseName) {
        return res.status(400).json({ error: "Disease name is required." });
    }

    const query = `
        SELECT 
        pd.disease_name,
        pd.symptoms,
        pd.prescriptions
        FROM 
            patients_data pd
        WHERE 
            pd.disease_name = ?
        ORDER BY 
            pd.created_at DESC
        LIMIT 10;
    `;

    db.query(query, [diseaseName], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Server Error" });
        }
        res.json(results);
    });
});

// POST endpoint to submit feedback
app.post('/submit_feedback', (req, res) => {
    const { patientID, feedback } = req.body;

    // Input validation
    if (!patientID || !feedback) {
        return res.status(400).json({ success: false, message: 'Invalid input.' });
    }

    // SQL query to update feedback in the database
    const query = `UPDATE patients_data 
                   SET comments = CONCAT(IFNULL(comments, ''), '\nFeedback: ', ?) 
                   WHERE patient_id = ?`;

    // Execute the query
    db.query(query, [feedback, patientID], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }

        // Check if the patient ID exists and was updated
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Patient ID not found.' });
        }

        // Respond with success message
        res.json({ success: true });
    });
});

// GET endpoint to view feedback
app.get('/view_feedback/:patientID', (req, res) => {
    const patientID = req.params.patientID; // Extract patientID from URL parameters

    // SQL query to fetch feedback for the given patient ID
    const query = `SELECT comments FROM patients_data WHERE patient_id = ?`;

    // Execute the query
    db.query(query, [patientID], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }

        // Check if feedback exists for the patient
        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'No feedback found for this patient.' });
        }

        // Return the feedback if found
        res.json({ success: true, comments: results[0].comments });
    });
});

app.get('/search_by_age_range', (req, res) => {
    const minAge = parseInt(req.query.minAge);
    const maxAge = parseInt(req.query.maxAge);

    if (isNaN(minAge) || isNaN(maxAge)) {
        return res.status(400).send('Invalid age range parameters.');
    }

    const query = 'CALL GetUsersByAgeRange(?, ?)';

    db.query(query, [minAge, maxAge], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send("Server Error");
        } else {
            res.json(results[0]); // Stored procedures return an array of results
        }
    });
});


// Backend endpoint for symptoms search
// Endpoint to search diseases by symptoms
app.get('/search_diseases_by_symptoms', (req, res) => {
    const symptoms = req.query.symptoms;

    if (!symptoms) {
        return res.status(400).send("Symptoms are required.");
    }

    const query = `
        SELECT DISTINCT 
            pd.disease_name AS Disease_Name,
            pd.symptoms AS Symptoms
        FROM patients_data pd
        WHERE pd.symptoms LIKE ?
    `;

    const queryParams = [`%${symptoms}%`];

    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send("Server Error");
        } else {
            res.json(results);
        }
    });
});

app.get('/search_doctors_by_specialist', (req, res) => {
    const specialist = req.query.specialist;

    if (!specialist) {
        return res.status(400).send("Specialist is required.");
    }

    const query = `
        SELECT 
            d.specialist AS Specialist,
            d.unique_id AS Doctor_ID,
            d.fullname AS Doctor_Name,
            d.medical_name AS Studied_Medical_Name,
            d.license_number AS License_Number
        FROM doctors d
        WHERE d.specialist LIKE ?
    `;

    const queryParams = [`%${specialist}%`];

    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send("Server Error");
        } else {
            res.json(results);
        }
    });
});

app.get('/search_diseases_by_district', (req, res) => {
    const district = req.query.district;

    if (!district) {
        return res.status(400).send("District is required.");
    }

    const query = `
        SELECT 
            m.district AS District,
            pd.disease_name AS Disease_Name,
            COUNT(pd.patient_id) AS Total_Patients
        FROM patients_data pd
        INNER JOIN medical m ON pd.admitted_medical_id = m.unique_id
        WHERE m.district = ?
        GROUP BY pd.disease_name, m.district
        ORDER BY Total_Patients DESC
    `;

    db.query(query, [district], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send("Server Error");
        } else {
            res.json(results);
        }
    });
});
app.get('/search_diseases_by_district', (req, res) => {
    const district = req.query.district;

    if (!district) {
        return res.status(400).send("District is required.");
    }

    const query = `
        SELECT 
            m.district AS District,
            pd.disease_name AS Disease_Name,
            COUNT(pd.patient_id) AS Total_Patients
        FROM patients_data pd
        INNER JOIN medical m ON pd.admitted_medical_id = m.unique_id
        WHERE m.district = ?
        GROUP BY pd.disease_name, m.district
        ORDER BY Total_Patients DESC
    `;

    db.query(query, [district], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send("Server Error");
        } else {
            res.json(results);
        }
    });
});
app.delete('/delete_record/:id', (req, res) => {
    const recordId = req.params.id;
    const query = `DELETE FROM patients_data WHERE id = ?`;
    db.query(query, [recordId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Error deleting record' });
        }
        res.json({ message: 'Record deleted successfully' });
    });
});


// API to fetch data entries by medical ID and date
// Backend route for searching medical data entries
app.get('/search_medical_data_entries', (req, res) => {
    const medicalId = req.query.medicalId;
    const searchDate = req.query.date;
    
    // Convert the date to start and end of day for comparison
    const startDate = new Date(searchDate);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(searchDate);
    endDate.setHours(23, 59, 59, 999);
    
    const query = `
      SELECT DISTINCT
        pd.patient_id,
        pd.patient_name,
        pd.admitted_medical_name,
        pd.created_at
      FROM
        patients_data pd
      WHERE
        pd.admitted_medical_id = ?
        AND pd.created_at BETWEEN ? AND ?
      ORDER BY
        pd.created_at DESC
    `;
  
    db.query(query, [medicalId, startDate, endDate], (err, results) => {
      if (err) {
        console.error(err);
        res.status(500).send("Server Error");
      } else {
        res.json(results);
      }
    });
  });



  
  app.post('/process_bill_payment', (req, res) => {
      const { uniqueId, billingAmount } = req.body;
  
      const checkUserQuery = 'SELECT fullname FROM users WHERE unique_id = ?';
      
      db.query(checkUserQuery, [uniqueId], (err, userResults) => {
          if (err) {
              return res.status(500).json({ error: 'Server error' });
          }
          
          if (userResults.length === 0) {
              return res.status(404).json({ error: 'User not found' });
          }
  
          // Use the custom function to calculate discount
          const discountQuery = 'SELECT calculate_discount(?, ?) AS discount';
          
          db.query(discountQuery, [uniqueId, billingAmount], (discountErr, discountResults) => {
              if (discountErr) {
                  return res.status(500).json({ error: 'Discount calculation failed' });
              }
  
              const discountPercentage = discountResults[0].discount;
              const discountAmount = billingAmount * (discountPercentage / 100);
              const payableAmount = billingAmount - discountAmount;
  
              const insertPaymentQuery = `
                  INSERT INTO bill_payments 
                  (unique_id, name, original_amount, discount_percentage, payable_amount) 
                  VALUES (?, ?, ?, ?, ?)
              `;
  
              db.query(
                  insertPaymentQuery, 
                  [
                      uniqueId, 
                      userResults[0].fullname, 
                      billingAmount, 
                      discountPercentage, 
                      payableAmount
                  ], 
                  (insertErr, result) => {
                      if (insertErr) {
                          return res.status(500).json({ error: 'Payment processing failed' });
                      }
  
                      res.status(200).json({
                          uniqueId: uniqueId,
                          name: userResults[0].fullname,
                          originalAmount: billingAmount,
                          discountPercentage: discountPercentage,
                          payableAmount: payableAmount
                      });
                  }
              );
          });
      });
  });

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});