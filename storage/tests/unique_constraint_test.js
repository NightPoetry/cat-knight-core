const path = require('path');
const fs = require('fs');
const SqlFunctionParser = require('../SqlFunctionParser');
const SQLiteAdapter = require('../adapters/SQLiteAdapter');
const { DBNumber, DBString } = require('../DataTypes');

// --- Test Framework Helper ---
async function runTest(name, testFn) {
    console.log(`\n=== Running Test: ${name} ===`);
    
    // Setup Env
    const dbPath = path.resolve(__dirname, `../../../../storage/unique_test_${Date.now()}.sqlite`);
    const adapter = new SQLiteAdapter(dbPath, { isolationLevel: 'SERIALIZABLE' });
    await adapter.init();
    const parser = new SqlFunctionParser(adapter);

    try {
        process.stdout.write(`Running ${name}... `);
        await testFn({ parser, adapter });
        console.log("✅ PASS");
        return true;
    } catch (e) {
        console.log("❌ FAIL");
        console.error(`   Error: ${e.message}`);
        console.error(e.stack);
        return false;
    } finally {
        await parser.close();
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
}

// --- Test Cases ---

async function runUniqueConstraintTests() {
    let passed = 0;
    let failed = 0;

    // Test 1: Create table with unique constraint
    const test1Result = await runTest("Create Table with Unique Constraint", async ({ parser }) => {
        const source = `
        User {
            number:id [primary]
            str[50]:email [not null] [unique]
            str[50]:username [unique]
        }
        
        CreateUser(number:id, str[50]:email, str[50]:username):
            Create a User with id of {id} and email of {email} and username of {username}
            return true
        `;
        await parser.parse(source);
        
        // Verify table creation succeeded
        const tableInfo = await parser.adapter.db.all(`PRAGMA table_info("User")`);
        const emailCol = tableInfo.find(col => col.name === 'email');
        const usernameCol = tableInfo.find(col => col.name === 'username');
        
        if (!emailCol) throw new Error("Email column not found");
        if (!usernameCol) throw new Error("Username column not found");
    });
    test1Result ? passed++ : failed++;

    // Test 2: Insert unique values (should succeed)
    const test2Result = await runTest("Insert Unique Values", async ({ parser }) => {
        const source = `
        User {
            number:id [primary]
            str[50]:email [not null] [unique]
        }
        
        CreateUser(number:id, str[50]:email):
            Create a User with id of {id} and email of {email}
            return true
        `;
        const api = await parser.parse(source);
        
        // Insert first user
        await api.CreateUser({
            id: new DBNumber(1),
            email: new DBString("user1@example.com")
        });
        
        // Insert second user with different email
        await api.CreateUser({
            id: new DBNumber(2),
            email: new DBString("user2@example.com")
        });
        
        // Verify both users exist
        const user1 = await parser.adapter.findOne("User", { id: 1 });
        const user2 = await parser.adapter.findOne("User", { id: 2 });
        
        if (!user1) throw new Error("User 1 not found");
        if (!user2) throw new Error("User 2 not found");
    });
    test2Result ? passed++ : failed++;

    // Test 3: Insert duplicate values (should fail)
    const test3Result = await runTest("Insert Duplicate Values", async ({ parser }) => {
        const source = `
        User {
            number:id [primary]
            str[50]:email [not null] [unique]
        }
        
        CreateUser(number:id, str[50]:email):
            Create a User with id of {id} and email of {email}
            return true
        `;
        const api = await parser.parse(source);
        
        // Debug: Check entity definition
        const userEntity = parser.entities["User"];
        console.log("   Entity Definition:", userEntity);
        console.log("   Email Field Definition:", userEntity.fields["email"]);
        
        // Debug: Check table schema
        const tableInfo = await parser.adapter.db.all(`PRAGMA table_info("User")`);
        console.log("   Table Info:", tableInfo);
        
        const indexes = await parser.adapter.db.all(`PRAGMA index_list("User")`);
        console.log("   Indexes:", indexes);
        
        // Insert first user
        await api.CreateUser({
            id: new DBNumber(1),
            email: new DBString("user@example.com")
        });
        
        // Try to insert duplicate email using direct SQL (to bypass any transaction handling)
        let errorOccurred = false;
        try {
            await parser.adapter.db.run(`INSERT INTO "User" (id, email) VALUES (?, ?)`, [2, "user@example.com"]);
        } catch (e) {
            errorOccurred = true;
            console.log("   Note: Direct SQL duplicate insertion correctly threw error:", e.message);
        }
        
        if (!errorOccurred) {
            // If direct SQL didn't fail, check what happened
            const users = await parser.adapter.db.all(`SELECT * FROM "User"`);
            console.log("   Users after duplicate insert:", users);
            throw new Error("Duplicate insertion should have failed with UNIQUE constraint error");
        }
        
        // Verify only one user exists
        const users = await parser.adapter.db.all(`SELECT * FROM "User"`);
        if (users.length !== 1) {
            throw new Error(`Expected 1 user, got ${users.length}`);
        }
    });
    test3Result ? passed++ : failed++;

    // Test 4: Multiple unique constraints
    const test4Result = await runTest("Multiple Unique Constraints", async ({ parser }) => {
        const source = `
        User {
            number:id [primary]
            str[50]:email [not null] [unique]
            str[50]:username [unique]
        }
        
        CreateUser(number:id, str[50]:email, str[50]:username):
            Create a User with id of {id} and email of {email} and username of {username}
            return true
        `;
        const api = await parser.parse(source);
        
        // Insert first user
        await api.CreateUser({
            id: new DBNumber(1),
            email: new DBString("user1@example.com"),
            username: new DBString("user1")
        });
        
        // Insert second user with same username but different email (should fail)
        let usernameError = false;
        try {
            await api.CreateUser({
                id: new DBNumber(2),
                email: new DBString("user2@example.com"),
                username: new DBString("user1") // Same username as user 1
            });
        } catch (e) {
            usernameError = true;
            console.log("   Note: Duplicate username insertion correctly failed");
        }
        
        if (!usernameError) {
            throw new Error("Duplicate username insertion should have failed");
        }
        
        // Insert second user with different username (should succeed)
        await api.CreateUser({
            id: new DBNumber(3),
            email: new DBString("user3@example.com"),
            username: new DBString("user3")
        });
        
        // Verify two users exist
        const users = await parser.adapter.db.all(`SELECT * FROM "User"`);
        if (users.length !== 2) {
            throw new Error(`Expected 2 users, got ${users.length}`);
        }
    });
    test4Result ? passed++ : failed++;

    console.log(`\n=== Test Results: ${passed} Passed, ${failed} Failed ===`);
    return failed === 0;
}

// Run the tests
runUniqueConstraintTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(err => {
    console.error("Test run failed with unexpected error:");
    console.error(err);
    process.exit(1);
});
