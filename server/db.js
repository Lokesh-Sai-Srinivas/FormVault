const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables if available
require('dotenv').config();

let dbType = 'sqlite'; // Default fallback
let firestoreDb = null;
let sqliteDb = null;

// Helper to generate UUIDs
function generateUUID() {
  return crypto.randomUUID();
}

// 1. Initialize Database
let projectId = process.env.FIREBASE_PROJECT_ID;
let clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

// Check if a service account file is placed in the project root
try {
  const parentDir = path.dirname(__dirname);
  const files = fs.readdirSync(parentDir);
  const serviceAccountFile = files.find(f => f.startsWith('formvault-') && f.endsWith('.json'));
  
  if (serviceAccountFile) {
    const configPath = path.join(parentDir, serviceAccountFile);
    const serviceAccount = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    projectId = serviceAccount.project_id;
    clientEmail = serviceAccount.client_email;
    privateKey = serviceAccount.private_key;
    console.log(`Auto-detected Firebase credentials JSON in root folder: ${serviceAccountFile}`);
  }
} catch (err) {
  console.warn('Did not load auto-detected credentials JSON:', err.message);
}

if (projectId && clientEmail && privateKey) {
  try {
    const admin = require('firebase-admin');
    
    // Format the private key (handle escaped newlines)
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: formattedPrivateKey,
      })
    });

    firestoreDb = admin.firestore();
    dbType = 'firebase';
    console.log(`Successfully connected to Cloud Firebase Firestore (Project: ${projectId}).`);
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK. Falling back to SQLite:', error.message);
  }
} else {
  console.log('Firebase credentials not complete. Using local SQLite database.');
}

if (dbType === 'sqlite') {
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, 'formvault.db');
  
  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Could not connect to SQLite database:', err.message);
    } else {
      console.log('Connected to local SQLite database at:', dbPath);
      createTables();
    }
  });
}

// 2. Schema creation for SQLite
function createTables() {
  sqliteDb.serialize(() => {
    // Users Table
    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      )
    `);

    // Profiles Table
    // fields: JSON string of field objects [{ label, value, type }]
    // sharedWith: JSON string of emails [ "friend1@example.com", ... ]
    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        fields TEXT NOT NULL,
        sharedWith TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (userId) REFERENCES users (id)
      )
    `);
  });
}

// 3. Unified Database API
const db = {
  getDbType: () => dbType,

  // --- User Operations ---

  createUser: async (email, passwordHash) => {
    const userId = generateUUID();
    const createdAt = Date.now();

    if (dbType === 'firebase') {
      const userRef = firestoreDb.collection('users').doc(userId);
      await userRef.set({
        email: email.toLowerCase(),
        password: passwordHash,
        createdAt
      });
      return { id: userId, email: email.toLowerCase() };
    } else {
      return new Promise((resolve, reject) => {
        const query = `INSERT INTO users (id, email, password, createdAt) VALUES (?, ?, ?, ?)`;
        sqliteDb.run(query, [userId, email.toLowerCase(), passwordHash, createdAt], function (err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              reject(new Error('User already exists'));
            } else {
              reject(err);
            }
          } else {
            resolve({ id: userId, email: email.toLowerCase() });
          }
        });
      });
    }
  },

  findUserByEmail: async (email) => {
    const targetEmail = email.toLowerCase();
    if (dbType === 'firebase') {
      const usersRef = firestoreDb.collection('users');
      const snapshot = await usersRef.where('email', '==', targetEmail).limit(1).get();
      
      if (snapshot.empty) return null;
      
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    } else {
      return new Promise((resolve, reject) => {
        const query = `SELECT * FROM users WHERE email = ?`;
        sqliteDb.get(query, [targetEmail], (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });
    }
  },

  findUserById: async (id) => {
    if (dbType === 'firebase') {
      const userRef = firestoreDb.collection('users').doc(id);
      const doc = await userRef.get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    } else {
      return new Promise((resolve, reject) => {
        const query = `SELECT * FROM users WHERE id = ?`;
        sqliteDb.get(query, [id], (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });
    }
  },

  // --- Profile Operations ---

  createProfile: async (profileName, fields, sharedWith, userId) => {
    const profileId = generateUUID();
    const createdAt = Date.now();
    const formattedFields = fields || [];
    const formattedSharedWith = (sharedWith || []).map(email => email.toLowerCase().trim());

    if (dbType === 'firebase') {
      const profileRef = firestoreDb.collection('profiles').doc(profileId);
      const newProfile = {
        userId,
        name: profileName,
        fields: formattedFields,
        sharedWith: formattedSharedWith,
        createdAt
      };
      await profileRef.set(newProfile);
      return { id: profileId, ...newProfile };
    } else {
      return new Promise((resolve, reject) => {
        const fieldsStr = JSON.stringify(formattedFields);
        const sharedWithStr = JSON.stringify(formattedSharedWith);
        const query = `INSERT INTO profiles (id, userId, name, fields, sharedWith, createdAt) VALUES (?, ?, ?, ?, ?, ?)`;
        
        sqliteDb.run(query, [profileId, userId, profileName, fieldsStr, sharedWithStr, createdAt], function (err) {
          if (err) {
            reject(err);
          } else {
            resolve({
              id: profileId,
              userId,
              name: profileName,
              fields: formattedFields,
              sharedWith: formattedSharedWith,
              createdAt
            });
          }
        });
      });
    }
  },

  getProfilesForUser: async (userId, userEmail) => {
    const email = userEmail.toLowerCase();
    if (dbType === 'firebase') {
      const profilesRef = firestoreDb.collection('profiles');
      
      // Get profiles owned by user
      const ownedSnapshot = await profilesRef.where('userId', '==', userId).get();
      const owned = ownedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Get profiles shared with user
      const sharedSnapshot = await profilesRef.where('sharedWith', 'array-contains', email).get();
      const shared = sharedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Merge and remove duplicates if any
      const allProfiles = [...owned];
      const ownedIds = new Set(owned.map(p => p.id));
      for (const p of shared) {
        if (!ownedIds.has(p.id)) {
          allProfiles.push(p);
        }
      }
      return allProfiles;
    } else {
      return new Promise((resolve, reject) => {
        // Query profiles owned by the user, or containing the user's email in the sharedWith JSON array
        const query = `SELECT * FROM profiles WHERE userId = ? OR sharedWith LIKE ?`;
        sqliteDb.all(query, [userId, `%${email}%`], (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const parsedRows = rows.map(row => {
              let fields = [];
              let sharedWith = [];
              try {
                fields = JSON.parse(row.fields);
              } catch (e) {}
              try {
                sharedWith = JSON.parse(row.sharedWith);
              } catch (e) {}

              return {
                id: row.id,
                userId: row.userId,
                name: row.name,
                fields,
                sharedWith,
                createdAt: row.createdAt
              };
            });

            // Double check array containment in JS to be safe (since SQL LIKE can have false positives)
            const filtered = parsedRows.filter(row => {
              return row.userId === userId || row.sharedWith.includes(email);
            });

            resolve(filtered);
          }
        });
      });
    }
  },

  updateProfile: async (profileId, userId, updateData) => {
    const formattedSharedWith = updateData.sharedWith 
      ? updateData.sharedWith.map(email => email.toLowerCase().trim())
      : undefined;

    if (dbType === 'firebase') {
      const profileRef = firestoreDb.collection('profiles').doc(profileId);
      const doc = await profileRef.get();
      
      if (!doc.exists) return null;
      if (doc.data().userId !== userId) {
        throw new Error('Unauthorized update access');
      }

      const updates = {};
      if (updateData.name !== undefined) updates.name = updateData.name;
      if (updateData.fields !== undefined) updates.fields = updateData.fields;
      if (formattedSharedWith !== undefined) updates.sharedWith = formattedSharedWith;

      await profileRef.update(updates);
      const updatedDoc = await profileRef.get();
      return { id: updatedDoc.id, ...updatedDoc.data() };
    } else {
      return new Promise((resolve, reject) => {
        // First verify ownership
        sqliteDb.get(`SELECT userId FROM profiles WHERE id = ?`, [profileId], (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          if (row.userId !== userId) {
            return reject(new Error('Unauthorized update access'));
          }

          const fieldsToUpdate = [];
          const values = [];

          if (updateData.name !== undefined) {
            fieldsToUpdate.push('name = ?');
            values.push(updateData.name);
          }
          if (updateData.fields !== undefined) {
            fieldsToUpdate.push('fields = ?');
            values.push(JSON.stringify(updateData.fields));
          }
          if (formattedSharedWith !== undefined) {
            fieldsToUpdate.push('sharedWith = ?');
            values.push(JSON.stringify(formattedSharedWith));
          }

          if (fieldsToUpdate.length === 0) {
            // Nothing to update
            return resolve({ id: profileId });
          }

          values.push(profileId);
          const query = `UPDATE profiles SET ${fieldsToUpdate.join(', ')} WHERE id = ?`;
          
          sqliteDb.run(query, values, function (err) {
            if (err) {
              reject(err);
            } else {
              // Fetch final record
              sqliteDb.get(`SELECT * FROM profiles WHERE id = ?`, [profileId], (err, row) => {
                if (err) return reject(err);
                resolve({
                  id: row.id,
                  userId: row.userId,
                  name: row.name,
                  fields: JSON.parse(row.fields),
                  sharedWith: JSON.parse(row.sharedWith),
                  createdAt: row.createdAt
                });
              });
            }
          });
        });
      });
    }
  },

  deleteProfile: async (profileId, userId) => {
    if (dbType === 'firebase') {
      const profileRef = firestoreDb.collection('profiles').doc(profileId);
      const doc = await profileRef.get();
      
      if (!doc.exists) return false;
      if (doc.data().userId !== userId) {
        throw new Error('Unauthorized delete access');
      }

      await profileRef.delete();
      return true;
    } else {
      return new Promise((resolve, reject) => {
        sqliteDb.get(`SELECT userId FROM profiles WHERE id = ?`, [profileId], (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(false);
          if (row.userId !== userId) {
            return reject(new Error('Unauthorized delete access'));
          }

          sqliteDb.run(`DELETE FROM profiles WHERE id = ?`, [profileId], function (err) {
            if (err) reject(err);
            else resolve(true);
          });
        });
      });
    }
  }
};

module.exports = db;
