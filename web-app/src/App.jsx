import React, { useState, useEffect } from 'react';
import { 
  Key, Shield, Plus, Trash2, Share2, LogOut, User, Mail, 
  Lock, Check, AlertCircle, UserPlus, X 
} from 'lucide-react';
import { auth, db } from './firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  doc, 
  updateDoc, 
  deleteDoc, 
  getDoc 
} from 'firebase/firestore';

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // Auth Screen States
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authActionLoading, setAuthActionLoading] = useState(false);

  // Profiles State
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [profilesLoading, setProfilesLoading] = useState(false);

  // Profile Editor Temp State
  const [tempName, setTempName] = useState('');
  const [tempFields, setTempFields] = useState([]);
  const [tempSharedWith, setTempSharedWith] = useState([]);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [newShareEmail, setNewShareEmail] = useState('');
  
  // Feedback Messages
  const [editorError, setEditorError] = useState('');
  const [editorSuccess, setEditorSuccess] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);

  // Track Firebase Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // Fetch profiles when logged in
  useEffect(() => {
    if (user) {
      fetchProfiles();
    } else {
      setProfiles([]);
      setSelectedProfile(null);
    }
  }, [user]);

  const fetchProfiles = async () => {
    if (!user) return;
    setProfilesLoading(true);
    try {
      const profilesRef = collection(db, 'profiles');
      
      // Query 1: Owned profiles
      const qOwned = query(profilesRef, where('userId', '==', user.uid));
      // Query 2: Shared profiles
      const qShared = query(profilesRef, where('sharedWith', 'array-contains', user.email.toLowerCase()));

      const [ownedSnap, sharedSnap] = await Promise.all([
        getDocs(qOwned),
        getDocs(qShared)
      ]);

      const owned = ownedSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const shared = sharedSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Merge and remove duplicates if any
      const allProfiles = [...owned];
      const ownedIds = new Set(owned.map(p => p.id));
      shared.forEach(p => {
        if (!ownedIds.has(p.id)) {
          allProfiles.push(p);
        }
      });

      setProfiles(allProfiles);
    } catch (error) {
      console.error('Error fetching profiles:', error);
    } finally {
      setProfilesLoading(false);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthActionLoading(true);
    setAuthError('');
    setEditorSuccess('');

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        setIsLogin(true);
        setAuthPassword('');
        setEditorSuccess('Registration successful! Please sign in.');
      }
    } catch (error) {
      // Format Firebase errors to look cleaner
      let msg = error.message;
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        msg = 'Invalid email or password.';
      } else if (error.code === 'auth/email-already-in-use') {
        msg = 'An account with this email already exists.';
      } else if (error.code === 'auth/weak-password') {
        msg = 'Password should be at least 6 characters.';
      } else if (error.code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      }
      setAuthError(msg);
    } finally {
      setAuthActionLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Select profile and populate editing state
  const handleSelectProfile = (profile) => {
    setSelectedProfile(profile);
    setTempName(profile.name);
    setTempFields(profile.fields ? [...profile.fields] : []);
    setTempSharedWith(profile.sharedWith ? [...profile.sharedWith] : []);
    setNewFieldLabel('');
    setNewFieldValue('');
    setNewShareEmail('');
    setEditorError('');
    setEditorSuccess('');
  };

  // Initialize fields for a new empty profile
  const handleCreateNewProfile = () => {
    const defaultFields = [
      { label: 'Full Name', value: '', type: 'text' },
      { label: 'Email Address', value: '', type: 'email' },
      { label: 'Phone Number', value: '', type: 'tel' },
      { label: 'College / Institute Name', value: '', type: 'text' },
      { label: 'College Roll Number', value: '', type: 'text' }
    ];
    
    const newTempProfile = {
      name: 'New Profile',
      fields: defaultFields,
      sharedWith: [],
      isNew: true
    };

    setSelectedProfile(newTempProfile);
    setTempName(newTempProfile.name);
    setTempFields(newTempProfile.fields);
    setTempSharedWith(newTempProfile.sharedWith);
    setNewFieldLabel('');
    setNewFieldValue('');
    setNewShareEmail('');
    setEditorError('');
    setEditorSuccess('');
  };

  // Check if selected profile is owned by current user
  const isOwner = selectedProfile && (!selectedProfile.userId || selectedProfile.userId === user?.uid);

  // Field editing
  const handleUpdateField = (index, value) => {
    const updated = [...tempFields];
    updated[index].value = value;
    setTempFields(updated);
  };

  const handleAddField = (e) => {
    e.preventDefault();
    if (!newFieldLabel.trim()) return;

    // Check duplicate
    const exists = tempFields.some(f => f.label.toLowerCase() === newFieldLabel.trim().toLowerCase());
    if (exists) {
      setEditorError(`Field "${newFieldLabel}" already exists.`);
      return;
    }

    setTempFields([...tempFields, { label: newFieldLabel.trim(), value: newFieldValue, type: 'text' }]);
    setNewFieldLabel('');
    setNewFieldValue('');
    setEditorError('');
  };

  const handleRemoveField = (index) => {
    setTempFields(tempFields.filter((_, i) => i !== index));
  };

  // Sharing profiles
  const handleAddShareEmail = (e) => {
    e.preventDefault();
    const email = newShareEmail.trim().toLowerCase();
    if (!email) return;

    if (email === user.email.toLowerCase()) {
      setEditorError("You don't need to share your profile with yourself!");
      return;
    }

    if (tempSharedWith.includes(email)) {
      setEditorError("Already shared with this user.");
      return;
    }

    setTempSharedWith([...tempSharedWith, email]);
    setNewShareEmail('');
    setEditorError('');
  };

  const handleRemoveShareEmail = (email) => {
    setTempSharedWith(tempSharedWith.filter(e => e !== email));
  };

  // Save changes directly to Firestore
  const handleSaveProfile = async () => {
    if (!tempName.trim()) {
      setEditorError('Profile name is required');
      return;
    }

    setEditorLoading(true);
    setEditorError('');
    setEditorSuccess('');

    try {
      const dataPayload = {
        name: tempName.trim(),
        fields: tempFields,
        sharedWith: tempSharedWith,
        userId: user.uid,
        updatedAt: Date.now()
      };

      let docId = '';

      if (selectedProfile && !selectedProfile.isNew) {
        docId = selectedProfile.id;
        const docRef = doc(db, 'profiles', docId);
        await updateDoc(docRef, dataPayload);
      } else {
        dataPayload.createdAt = Date.now();
        const profilesCollection = collection(db, 'profiles');
        const docRef = await addDoc(profilesCollection, dataPayload);
        docId = docRef.id;
      }

      setEditorSuccess('Profile saved successfully!');
      await fetchProfiles();
      
      // Refresh current editor selection
      const updatedProfile = { id: docId, ...dataPayload };
      setSelectedProfile(updatedProfile);
      setTempName(updatedProfile.name);
      setTempFields(updatedProfile.fields);
      setTempSharedWith(updatedProfile.sharedWith);
    } catch (error) {
      setEditorError(error.message);
    } finally {
      setEditorLoading(false);
    }
  };

  // Delete profile from Firestore
  const handleDeleteProfile = async () => {
    if (!selectedProfile || selectedProfile.isNew) {
      setSelectedProfile(null);
      return;
    }

    if (!window.confirm(`Are you sure you want to delete the profile "${selectedProfile.name}"?`)) {
      return;
    }

    setEditorLoading(true);
    try {
      const docRef = doc(db, 'profiles', selectedProfile.id);
      await deleteDoc(docRef);
      setSelectedProfile(null);
      await fetchProfiles();
    } catch (error) {
      setEditorError(error.message);
    } finally {
      setEditorLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-dark)' }}>
        <div className="spinner" style={{ borderTopColor: 'var(--primary)', width: '32px', height: '32px', borderWidth: '3px' }}></div>
      </div>
    );
  }

  if (!user) {
    // Auth view
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center', marginBottom: '24px' }}>
            <div className="text-highlight" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center' }}>
              <Key style={{ width: '28px', height: '28px', marginRight: '6px' }} />
              <strong>FormVault</strong>
            </div>
          </div>

          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }}>
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '24px', textAlign: 'center' }}>
            {isLogin ? 'Secure your form credentials under lock and key.' : 'Sign up to create and sync form templates.'}
          </p>

          {editorSuccess && (
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', color: '#6ee7b7', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Check style={{ width: '16px', height: '16px' }} />
              {editorSuccess}
            </div>
          )}

          {authError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle style={{ width: '16px', height: '16px' }} />
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth}>
            <div className="form-group">
              <label>Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail style={{ position: 'absolute', left: '14px', top: '14px', width: '18px', height: '18px', color: 'var(--text-dim)' }} />
                <input 
                  type="email" 
                  className="input-field" 
                  style={{ paddingLeft: '44px' }}
                  value={authEmail} 
                  onChange={(e) => setAuthEmail(e.target.value)} 
                  required 
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock style={{ position: 'absolute', left: '14px', top: '14px', width: '18px', height: '18px', color: 'var(--text-dim)' }} />
                <input 
                  type="password" 
                  className="input-field" 
                  style={{ paddingLeft: '44px' }}
                  value={authPassword} 
                  onChange={(e) => setAuthPassword(e.target.value)} 
                  required 
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '8px' }} disabled={authActionLoading}>
              {authActionLoading ? (
                <>
                  <div className="spinner" style={{ borderTopColor: 'white' }}></div> 
                  Processing...
                </>
              ) : isLogin ? 'Sign In' : 'Register'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {isLogin ? "New to FormVault? " : "Already have an account? "}
            <button 
              type="button" 
              onClick={() => { setIsLogin(!isLogin); setAuthError(''); setEditorSuccess(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-highlight)', fontWeight: 600, cursor: 'pointer', outline: 'none' }}
            >
              {isLogin ? 'Create Account' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Navigation */}
      <nav className="nav-container">
        <div className="nav-logo">
          <Key className="icon" style={{ width: '20px', height: '20px', color: '#fff' }} />
          Form<span className="text-highlight">Vault</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255, 255, 255, 0.04)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <User style={{ width: '16px', height: '16px', color: 'var(--text-highlight)' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{user.email}</span>
          </div>
          <button className="btn btn-secondary" style={{ padding: '8px 14px', fontSize: '0.8rem' }} onClick={handleLogout}>
            <LogOut style={{ width: '14px', height: '14px' }} />
            Logout
          </button>
        </div>
      </nav>

      {/* Main Panel Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', flexGrow: 1, padding: '24px', gap: '24px' }}>
        
        {/* Sidebar (Profiles selection) */}
        <aside style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--border-radius)', padding: '20px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', position: 'sticky', top: '100px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>Profiles</h3>
            <button className="btn btn-primary" style={{ padding: '6px 10px', fontSize: '0.75rem', borderRadius: '6px' }} onClick={handleCreateNewProfile}>
              <Plus style={{ width: '14px', height: '14px' }} /> New
            </button>
          </div>

          <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
            {profilesLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                <div className="spinner" style={{ borderTopColor: 'var(--primary)' }}></div>
              </div>
            ) : profiles.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem', padding: '40px 10px', lineHeight: 1.4 }}>
                No profiles configured.<br />Click "+ New" to get started!
              </div>
            ) : (
              profiles.map(p => {
                const isActive = selectedProfile && selectedProfile.id === p.id;
                const isShared = p.userId !== user.uid;
                return (
                  <button 
                    key={p.id}
                    onClick={() => handleSelectProfile(p)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '12px 14px',
                      background: isActive ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid',
                      borderColor: isActive ? 'var(--primary)' : 'rgba(255, 255, 255, 0.06)',
                      borderRadius: '8px',
                      color: 'var(--text-main)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'var(--transition)'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                      <span style={{ fontWeight: isActive ? 700 : 500, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {p.fields?.length || 0} fields
                      </span>
                    </div>
                    {isShared && (
                      <span style={{ fontSize: '0.65rem', background: 'rgba(16, 185, 129, 0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.2)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                        Shared
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div style={{ marginTop: '20px', padding: '12px', background: 'rgba(139, 92, 246, 0.05)', border: '1px solid rgba(139, 92, 246, 0.1)', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            💡 Log in to the extension using the same credentials to sync these profiles instantly.
          </div>
        </aside>

        {/* Editor Panel */}
        <main style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--border-radius)', padding: '28px', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 140px)' }}>
          {!selectedProfile ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, color: 'var(--text-muted)', textAlign: 'center' }}>
              <Shield style={{ width: '48px', height: '48px', color: 'var(--text-dim)', marginBottom: '16px' }} />
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px' }}>Select or Create a Profile</h3>
              <p style={{ fontSize: '0.85rem', maxWidth: '320px', lineHeight: 1.5 }}>
                Configure your personal templates, address credentials, or sharing policies. Once saved, they sync to your extensions automatically.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              {/* Header Editor Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '20px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexGrow: 1, maxWidth: '60%' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Profile Name</label>
                  <input 
                    type="text" 
                    value={tempName} 
                    onChange={(e) => setTempName(e.target.value)} 
                    disabled={!isOwner}
                    className="input-field" 
                    style={{ fontSize: '1.25rem', fontWeight: 700, border: !isOwner ? 'none' : undefined, background: !isOwner ? 'transparent' : undefined, padding: !isOwner ? '0' : undefined }}
                    placeholder="Profile Name (e.g. My Personal Details)"
                  />
                  {!isOwner && (
                    <span style={{ fontSize: '0.75rem', color: '#6ee7b7', fontWeight: 500 }}>
                      ℹ️ This profile is shared with you. You can view fields but cannot modify them.
                    </span>
                  )}
                </div>

                {isOwner && (
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-secondary" onClick={handleSaveProfile} disabled={editorLoading}>
                      Save Changes
                    </button>
                    <button className="btn btn-danger" onClick={handleDeleteProfile} disabled={editorLoading}>
                      <Trash2 style={{ width: '16px', height: '16px' }} />
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {/* Status Indicator Alerts */}
              {editorError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5', padding: '12px 16px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
                  {editorError}
                </div>
              )}

              {editorSuccess && (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', color: '#6ee7b7', padding: '12px 16px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Check style={{ width: '18px', height: '18px', flexShrink: 0 }} />
                  {editorSuccess}
                </div>
              )}

              {/* Grid content split: Fields List vs Sharing controls */}
              <div style={{ display: 'grid', gridTemplateColumns: isOwner ? '1fr 340px' : '1fr', gap: '28px', flexGrow: 1 }}>
                
                {/* Fields Editor List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '6px' }}>
                    Profile Fields
                  </h4>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: 'calc(100vh - 350px)', overflowY: 'auto', paddingRight: '4px' }}>
                    {tempFields.map((field, idx) => (
                      <div 
                        key={idx} 
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          background: 'rgba(255,255,255,0.01)',
                          border: '1px solid rgba(255,255,255,0.04)',
                          borderRadius: '8px',
                          padding: '8px 12px'
                        }}
                      >
                        <div style={{ flexBasis: '220px', flexShrink: 0, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-highlight)' }}>
                          {field.label}
                        </div>
                        <input 
                          type="text" 
                          value={field.value} 
                          onChange={(e) => handleUpdateField(idx, e.target.value)}
                          disabled={!isOwner}
                          className="input-field" 
                          style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                          placeholder={`Enter ${field.label}`}
                        />
                        {isOwner && (
                          <button 
                            onClick={() => handleRemoveField(idx)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '4px', transition: 'var(--transition)' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                            title="Remove Field"
                          >
                            <Trash2 style={{ width: '16px', height: '16px' }} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Add Custom Field Form */}
                  {isOwner && (
                    <form onSubmit={handleAddField} style={{ display: 'flex', gap: '10px', marginTop: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px' }}>
                      <input 
                        type="text" 
                        value={newFieldLabel} 
                        onChange={(e) => setNewFieldLabel(e.target.value)} 
                        className="input-field" 
                        style={{ padding: '8px 12px', fontSize: '0.85rem' }} 
                        placeholder="Field Label (e.g. Roll No)" 
                      />
                      <input 
                        type="text" 
                        value={newFieldValue} 
                        onChange={(e) => setNewFieldValue(e.target.value)} 
                        className="input-field" 
                        style={{ padding: '8px 12px', fontSize: '0.85rem' }} 
                        placeholder="Field Value" 
                      />
                      <button type="submit" className="btn btn-secondary" style={{ padding: '8px 14px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        <Plus style={{ width: '16px', height: '16px' }} /> Add Field
                      </button>
                    </form>
                  )}
                </div>

                {/* Right Side: Sharing Management Panel (Visible to Owner only) */}
                {isOwner && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Share2 style={{ width: '18px', height: '18px', color: 'var(--text-highlight)' }} />
                      <h4 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Share Profile</h4>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      Grant your friends access to autofill forms using this profile. They will see it in their FormVault browser extension!
                    </p>

                    {/* Add Email form */}
                    <form onSubmit={handleAddShareEmail} style={{ display: 'flex', gap: '8px' }}>
                      <input 
                        type="email" 
                        value={newShareEmail} 
                        onChange={(e) => setNewShareEmail(e.target.value)} 
                        className="input-field" 
                        style={{ padding: '8px 12px', fontSize: '0.85rem' }} 
                        placeholder="friend@email.com" 
                      />
                      <button type="submit" className="btn btn-primary" style={{ padding: '8px 12px', fontSize: '0.8rem', borderRadius: '8px' }}>
                        <UserPlus style={{ width: '16px', height: '16px' }} />
                      </button>
                    </form>

                    {/* Shared user list */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1, overflowY: 'auto', maxHeight: '180px' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Shared With</span>
                      
                      {tempSharedWith.length === 0 ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic', padding: '10px 0' }}>
                          Not shared with anyone yet.
                        </div>
                      ) : (
                        tempSharedWith.map((email) => (
                          <div 
                            key={email}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              background: 'rgba(255,255,255,0.03)',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              border: '1px solid rgba(255,255,255,0.04)'
                            }}
                          >
                            <span style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                              {email}
                            </span>
                            <button 
                              onClick={() => handleRemoveShareEmail(email)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', padding: '2px' }}
                              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                              title="Revoke access"
                            >
                              <X style={{ width: '14px', height: '14px' }} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
