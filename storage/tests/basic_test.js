const path = require('path');
const fs = require('fs');
const SqlFunctionParser = require('../SqlFunctionParser');
const SQLiteAdapter = require('../adapters/SQLiteAdapter');
const { DBNumber, DBString, DBBool } = require('../DataTypes');

// --- Test Framework Helper ---
async function runSuite(name, tests) {
    console.log(`\n=== Running Suite: ${name} ===`);
    let passed = 0;
    let failed = 0;
    
    // Setup Env
    const dbPath = path.resolve(__dirname, `../../../../storage/test_${Date.now()}.sqlite`);
    const adapter = new SQLiteAdapter(dbPath, { isolationLevel: 'SERIALIZABLE' });
    await adapter.init();
    const parser = new SqlFunctionParser(adapter);

    try {
        for (const [testName, testFn] of Object.entries(tests)) {
            try {
                process.stdout.write(`Running ${testName}... `);
                await testFn({ parser, adapter });
                console.log("✅ PASS");
                passed++;
            } catch (e) {
                console.log("❌ FAIL");
                console.error(`   Error: ${e.message}`);
                console.error(e.stack);
                failed++;
            }
        }
    } finally {
        await parser.close();
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
    
    console.log(`\nSuite Result: ${passed} Passed, ${failed} Failed`);
    return failed === 0;
}

// --- Test Cases ---

const basicTests = {
    "Schema Creation": async ({ parser }) => {
        const source = `
        TestUser {
            number:id [primary]
            str[20]:username [not null]
            bool:is_admin (false)
        }
        `;
        await parser.parse(source);
        
        // Verify via raw adapter
        const tableInfo = await parser.adapter.db.all(`PRAGMA table_info("TestUser")`);
        if (tableInfo.length !== 3) throw new Error("Table column count mismatch");
        const cols = tableInfo.map(c => c.name);
        if (!cols.includes("username")) throw new Error("Column 'username' missing");
    },

    "CRUD Operations": async ({ parser }) => {
        const source = `
        Item {
            number:id [primary]
            str[50]:name
            number[10.2]:price
        }
        
        CreateItem(number:id, str[50]:name, number:price):
            Create a Item with id of {id} and name of {name} and price of {price} as newItem
            return {newItem}
            
        UpdatePrice(number:id, number:newPrice):
            Get a Item by id of {id} as item
            Update item to set price = {newPrice}
            return {item.price}
        `;
        const api = await parser.parse(source);
        
        // Create
        await api.CreateItem({ id: new DBNumber(1), name: new DBString("Sword"), price: new DBNumber("100.50", 10, 2) });
        
        // Verify Insert
        const item = await parser.adapter.findOne("Item", { id: 1 });
        if (item.price !== "100.50") throw new Error(`Insert failed value mismatch: Got ${item.price}`);
        
        // Update
        const newPrice = await api.UpdatePrice({ id: new DBNumber(1), newPrice: new DBNumber("150.00", 10, 2) });
        // item.price returns DBNumber, so toString() works. 
        // 150.00 might be 150 if processed through some layers, but DBNumber usually keeps scale if specified.
        // Let's check fixed behavior.
        if (newPrice.getValue() !== "150.00" && newPrice.toString() !== "150.00") throw new Error(`Update return value mismatch: Got ${newPrice.toString()}`);
        
        // Verify DB Update
        const updatedItem = await parser.adapter.findOne("Item", { id: 1 });
        if (updatedItem.price !== "150.00") throw new Error(`Update persistence failed: Got ${updatedItem.price}`);
    },

    "Transaction Rollback": async ({ parser }) => {
        const source = `
        Account {
            number:id [primary]
            number[10.2]:balance
        }
        
        RiskyTransfer(number:id, number:amount):
            Get a Account by id of {id} as acc
            Update acc to set balance = {acc.balance} - {amount}
            
            # Trigger Error: Amount too large (precision check)
            If {amount} > 1000:
                 # This creates a value that violates schema number[10.2] if we try to insert/update elsewhere
                 # Or we can just throw by accessing invalid var
                 Set {dummy} = {non_existent.field}
            
            return true
        `;
        const api = await parser.parse(source);
        
        // Seed
        await parser.adapter.insert("Account", { id: 1, balance: "500.00" });
        
        // Test Rollback
        try {
            await api.RiskyTransfer({ id: new DBNumber(1), amount: new DBNumber("2000.00") });
            // Note: If RiskyTransfer doesn't throw, we manually fail the test
            throw new Error("Transaction should have failed");
        } catch (e) {
            // Expected error. 
            // In current impl, "Set {dummy} = {non_existent.field}" might not throw if we don't strict check variable existence, 
            // or if it just evaluates to null.
            // But we WANT it to throw to trigger rollback.
            // Let's ensure the test DSL actually causes an error.
            if (e.message === "Transaction should have failed") throw e;
        }
        
        // Verify Balance Unchanged
        const acc = await parser.adapter.findOne("Account", { id: 1 });
        if (acc.balance !== "500.00") throw new Error(`Rollback failed. Balance is ${acc.balance}`);
    },
    
    "Complex Logic (If/Else)": async ({ parser }) => {
        const source = `
        LogicTest { number:id [primary], number:val }
        
        CheckValue(number:val):
            If {val} > 10:
                return "High"
            If {val} < 5:
                return "Low"
            return "Medium"
        `;
        const api = await parser.parse(source);
        
        const r1 = await api.CheckValue({ val: new DBNumber(20) });
        if (r1.getValue() !== "High") throw new Error(`If > 10 failed, got ${r1.getValue()}`);
        
        const r2 = await api.CheckValue({ val: new DBNumber(2) });
        if (r2.getValue() !== "Low") throw new Error(`If < 5 failed, got ${r2.getValue()}`);
        
        const r3 = await api.CheckValue({ val: new DBNumber(7) });
        if (r3.getValue() !== "Medium") throw new Error(`Else/Fallthrough failed, got ${r3.getValue()}`);
    },

    "Lazy Loading": async ({ parser }) => {
        const source = `
        User {
            number:id [primary]
            str[50]:name
            List[Post]:posts
        }
        
        Post {
            number:id [primary]
            str[100]:title
        }
        
        GetUser(number:id):
            Get a User by id of {id} as user
            return {user}
            
        GetUserPosts(number:id):
            Get a User by id of {id} as user
            # Accessing .posts triggers lazy load via intermediate table
            return {user.posts}
        `;
        const api = await parser.parse(source);
        
        // Seed
        await parser.adapter.insert("User", { id: 1, name: "Blogger" });
        await parser.adapter.insert("Post", { id: 101, title: "First Post" });
        await parser.adapter.insert("Post", { id: 102, title: "Second Post" });
        
        // Seed Relation Table (post_user)
        // Table: post_user (alphabetical: p before u)
        // Columns: post_id, user_id
        await parser.adapter.db.run(`INSERT INTO "post_user" ("post_id", "user_id") VALUES (?, ?)`, ["101", "1"]);
        await parser.adapter.db.run(`INSERT INTO "post_user" ("post_id", "user_id") VALUES (?, ?)`, ["102", "1"]);
        
        // Test 1: Get User (Should NOT load posts)
        const user = await api.GetUser({ id: new DBNumber(1) });
        // user is now a Plain Object (serialized), NOT Entity instance
        
        // Check content
        if (user.posts !== undefined) throw new Error("Lazy load triggered prematurely! Posts should not be in JSON if not accessed.");
        
        // Test 2: Get Posts (Should trigger load)
        const posts = await api.GetUserPosts({ id: new DBNumber(1) });
        // posts is array of Plain Objects
        if (!Array.isArray(posts)) throw new Error("Expected array of posts");
        if (posts.length !== 2) throw new Error(`Expected 2 posts, got ${posts.length}`);
        
        // Check content
        // Order is not guaranteed by DB usually, but SQLite often returns insertion order. 
        // Let's sort to be safe.
        posts.sort((a, b) => parseInt(a.id) - parseInt(b.id));
        
        if (posts[0].title !== "First Post") throw new Error(`Post data mismatch, got ${posts[0].title}`);
    },

    "Orphan Removal (GC)": async ({ parser }) => {
        const source = `
        Class {
            number:id [primary]
            str:name
            List[Student]:students
        }
        
        # Student depends on Class
        Student (Class) {
            number:id [primary]
            str:name
        }
        
        # Multi-owner
        Post { 
            number:id [primary]
            List[Tag]:tags 
        }
        User { 
            number:id [primary]
            List[Tag]:tags 
        }
        Tag (Post, User) { 
            number:id [primary]
            str:name 
        }
        `;
        await parser.parse(source);
        
        // --- Scenario 1: Single Dependency ---
        await parser.adapter.insert("Class", { id: 201, name: "Math" });
        await parser.adapter.insert("Student", { id: 201, name: "Bob" });
        // Link
        await parser.adapter.db.run(`INSERT INTO "class_student" ("class_id", "student_id") VALUES (?, ?)`, ["201", "201"]);
        
        // Verify Existence
        const bob = await parser.adapter.findOne("Student", { id: 201 });
        if (!bob) throw new Error("Bob should exist");
        
        // Remove Link (Delete relation, trigger should fire)
        await parser.adapter.db.run(`DELETE FROM "class_student" WHERE "class_id" = ? AND "student_id" = ?`, ["201", "201"]);
        
        // Verify Bob is Gone
        const bobGone = await parser.adapter.findOne("Student", { id: 201 });
        if (bobGone) throw new Error("Bob should have been garbage collected!");
        
        // --- Scenario 2: Multi Dependency ---
        await parser.adapter.insert("Post", { id: 301 });
        await parser.adapter.insert("User", { id: 301 });
        await parser.adapter.insert("Tag", { id: 999, name: "Tech" });
        
        // Link to Both
        await parser.adapter.db.run(`INSERT INTO "post_tag" ("post_id", "tag_id") VALUES (?, ?)`, ["301", "999"]);
        await parser.adapter.db.run(`INSERT INTO "tag_user" ("tag_id", "user_id") VALUES (?, ?)`, ["999", "301"]); // alphabetical: tag_user
        
        // Remove Link 1 (Post)
        await parser.adapter.db.run(`DELETE FROM "post_tag" WHERE "post_id" = ?`, ["301"]);
        
        // Tag should still exist (User still holds it)
        const tagStillThere = await parser.adapter.findOne("Tag", { id: 999 });
        if (!tagStillThere) throw new Error("Tag should still exist (held by User)");
        
        // Remove Link 2 (User)
        await parser.adapter.db.run(`DELETE FROM "tag_user" WHERE "user_id" = ?`, ["301"]);
        
        // Tag should be Gone
        const tagGone = await parser.adapter.findOne("Tag", { id: 999 });
        if (tagGone) throw new Error("Tag should have been GC'd after losing all references!");
    },

    "Loop Logic (ForEach)": async ({ parser }) => {
        const source = `
        Product {
            number:id [primary]
            number:price
        }
        
        Cart {
            number:id [primary]
            List[Product]:items
        }
        
        CalculateTotal(number:cartId):
            Get a Cart by id of {cartId} as cart
            Set {total} = 0
            
            # cart.items triggers lazy load
            For Each item in {cart.items}:
                Set {total} = {total} + {item.price}
                
            return {total}
        `;
        const api = await parser.parse(source);
        
        // Seed Data
        await parser.adapter.insert("Cart", { id: 1 });
        await parser.adapter.insert("Product", { id: 101, price: "10.50" });
        await parser.adapter.insert("Product", { id: 102, price: "20.00" });
        await parser.adapter.insert("Product", { id: 103, price: "5.50" });
        
        // Link Items to Cart
        // Table: cart_product
        await parser.adapter.db.run(`INSERT INTO "cart_product" ("cart_id", "product_id") VALUES (?, ?)`, ["1", "101"]);
        await parser.adapter.db.run(`INSERT INTO "cart_product" ("cart_id", "product_id") VALUES (?, ?)`, ["1", "102"]);
        await parser.adapter.db.run(`INSERT INTO "cart_product" ("cart_id", "product_id") VALUES (?, ?)`, ["1", "103"]);
        
        // Calculate
        const total = await api.CalculateTotal({ cartId: new DBNumber(1) });
        
        // Expected: 10.50 + 20.00 + 5.50 = 36.00
        if (total.getValue() !== "36.00" && total.getValue() !== "36") { // DBNumber might normalize 36.00 to 36 or keep scale
             // DBNumber add usually keeps max scale. 10.50 (scale 2) + 20.00 (scale 2) = 30.50
             throw new Error(`Loop calculation failed. Expected 36.00, got ${total.getValue()}`);
        }
    }
};

runSuite("Core Storage Functionality", basicTests);
