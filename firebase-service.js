// ========== FIREBASE SERVICE ==========
class FirebaseService {
    constructor() {
        this.auth = firebaseAuth;
        this.db = firebaseFirestore;
        this.storage = firebaseStorage;
        this.currentUser = null;
        this.userData = null;
        
        console.log('Firebase Service initialized');
        
        // Listen for auth state changes
        this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log('🔥 User signed in:', user.email);
                this.currentUser = user;
                await this.loadUserData();
                
                // Trigger callback if exists
                if (this.onUserChanged) {
                    this.onUserChanged(this.userData);
                }
            } else {
                console.log('🔥 User signed out');
                this.currentUser = null;
                this.userData = null;
                
                if (this.onUserChanged) {
                    this.onUserChanged(null);
                }
            }
        });
    }
    
    // ========== AUTHENTICATION ==========
    async register(email, password, userData) {
        try {
            console.log('Registering user:', email);
            
            // 1. Create user in Firebase Auth
            const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            console.log('Auth user created:', user.uid);
            
            // 2. Prepare user data for Firestore
            const userProfile = {
                ...userData,
                uid: user.uid,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            // 3. Save to Firestore
            await this.db.collection('users').doc(user.uid).set(userProfile);
            
            console.log('User data saved to Firestore');
            
            // 4. Also save to localStorage for offline
            localStorage.setItem(`user_${user.uid}`, JSON.stringify(userProfile));
            
            return { 
                success: true, 
                user: user,
                userData: userProfile
            };
            
        } catch (error) {
            console.error('🔥 Registration error:', error);
            return { 
                success: false, 
                message: this.getFirebaseErrorMessage(error),
                code: error.code
            };
        }
    }
    
    async login(email, password) {
        try {
            console.log('Logging in:', email);
            
            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            // Update last login time
            await this.db.collection('users').doc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('Login successful:', user.email);
            
            return { 
                success: true, 
                user: user
            };
            
        } catch (error) {
            console.error('🔥 Login error:', error);
            return { 
                success: false, 
                message: this.getFirebaseErrorMessage(error),
                code: error.code
            };
        }
    }
    
    async logout() {
        try {
            await this.auth.signOut();
            console.log('Logout successful');
            return { success: true };
        } catch (error) {
            console.error('🔥 Logout error:', error);
            return { success: false, message: error.message };
        }
    }
    
    // ========== USER DATA MANAGEMENT ==========
    async loadUserData() {
        if (!this.currentUser) {
            console.log('No user logged in');
            return null;
        }
        
        try {
            console.log('Loading user data for:', this.currentUser.uid);
            
            // Try to get from Firestore first
            const docRef = this.db.collection('users').doc(this.currentUser.uid);
            const doc = await docRef.get();
            
            if (doc.exists) {
                const firestoreData = doc.data();
                console.log('Firestore data loaded:', firestoreData);
                
                // Also get from localStorage
                const localData = JSON.parse(localStorage.getItem(`user_${this.currentUser.uid}`) || '{}');
                
                // Merge data (Firestore has priority)
                this.userData = {
                    ...localData,
                    ...firestoreData,
                    id: this.currentUser.uid,
                    email: this.currentUser.email
                };
                
                // Save merged data back to localStorage
                localStorage.setItem(`user_${this.currentUser.uid}`, JSON.stringify(this.userData));
                
                return this.userData;
            } else {
                console.log('No Firestore data, checking localStorage');
                // Check localStorage
                const localData = JSON.parse(localStorage.getItem(`user_${this.currentUser.uid}`) || 'null');
                
                if (localData) {
                    this.userData = localData;
                    // Save to Firestore for future
                    await this.saveUserDataToFirestore(localData);
                }
                
                return this.userData;
            }
            
        } catch (error) {
            console.error('🔥 Load user data error:', error);
            
            // Fallback to localStorage
            const localData = JSON.parse(localStorage.getItem(`user_${this.currentUser.uid}`) || 'null');
            this.userData = localData;
            
            return this.userData;
        }
    }
    
    async saveUserData(userData) {
        if (!this.currentUser) {
            console.log('No user, saving to localStorage only');
            // Save to localStorage with a temp ID
            const tempId = 'local_' + Date.now();
            localStorage.setItem(`user_${tempId}`, JSON.stringify(userData));
            return { success: true, offline: true };
        }
        
        try {
            console.log('Saving user data to Firestore');
            
            // Prepare data for Firestore
            const dataToSave = {
                monthlyLimit: userData.monthlyLimit || 0,
                expenses: userData.expenses || [],
                categories: userData.categories || [],
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                ...(userData.name && { name: userData.name }),
                ...(userData.username && { username: userData.username }),
                ...(userData.avatar && { avatar: userData.avatar })
            };
            
            // Save to Firestore
            await this.db.collection('users').doc(this.currentUser.uid).update(dataToSave);
            
            // Update local userData
            if (this.userData) {
                this.userData = { ...this.userData, ...dataToSave };
            }
            
            // Also save to localStorage
            localStorage.setItem(`user_${this.currentUser.uid}`, JSON.stringify(this.userData || userData));
            
            console.log('User data saved successfully');
            return { success: true, offline: false };
            
        } catch (error) {
            console.error('🔥 Save user data error:', error);
            
            // Save to localStorage as fallback
            localStorage.setItem(`user_${this.currentUser.uid}`, JSON.stringify(userData));
            
            return { success: true, offline: true };
        }
    }
    
    async saveUserDataToFirestore(userData) {
        try {
            if (!this.currentUser) return;
            
            await this.db.collection('users').doc(this.currentUser.uid).set({
                ...userData,
                uid: this.currentUser.uid,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
        } catch (error) {
            console.error('Save to Firestore error:', error);
        }
    }
    
    // ========== PROFILE MANAGEMENT ==========
    async updateProfile(profileData) {
        try {
            if (!this.currentUser) {
                throw new Error('No user logged in');
            }
            
            console.log('Updating profile:', profileData);
            
            const updateData = {
                ...profileData,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            // Update Firestore
            await this.db.collection('users').doc(this.currentUser.uid).update(updateData);
            
            // Update local data
            if (this.userData) {
                this.userData = { ...this.userData, ...updateData };
                localStorage.setItem(`user_${this.currentUser.uid}`, JSON.stringify(this.userData));
            }
            
            return { success: true };
            
        } catch (error) {
            console.error('🔥 Update profile error:', error);
            return { 
                success: false, 
                message: error.message 
            };
        }
    }
    
    async changePassword(currentPassword, newPassword) {
        try {
            if (!this.currentUser) {
                throw new Error('No user logged in');
            }
            
            console.log('Changing password');
            
            // Re-authenticate user
            const credential = firebase.auth.EmailAuthProvider.credential(
                this.currentUser.email, 
                currentPassword
            );
            
            await this.currentUser.reauthenticateWithCredential(credential);
            
            // Update password
            await this.currentUser.updatePassword(newPassword);
            
            return { success: true };
            
        } catch (error) {
            console.error('🔥 Change password error:', error);
            return { 
                success: false, 
                message: this.getFirebaseErrorMessage(error)
            };
        }
    }
    
    async uploadProfilePicture(file) {
        try {
            if (!this.currentUser) {
                // Convert to base64 for localStorage
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve({ 
                        success: true, 
                        url: e.target.result,
                        offline: true 
                    });
                    reader.readAsDataURL(file);
                });
            }
            
            console.log('Uploading profile picture');
            
            // Create storage reference
            const storageRef = this.storage.ref();
            const fileRef = storageRef.child(`profile_pictures/${this.currentUser.uid}/${Date.now()}_${file.name}`);
            
            // Upload file
            const snapshot = await fileRef.put(file);
            const downloadURL = await snapshot.ref.getDownloadURL();
            
            console.log('File uploaded, URL:', downloadURL);
            
            // Update user profile with new photo URL
            await this.db.collection('users').doc(this.currentUser.uid).update({
                avatar: downloadURL,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // Update local data
            if (this.userData) {
                this.userData.avatar = downloadURL;
                localStorage.setItem(`user_${this.currentUser.uid}`, JSON.stringify(this.userData));
            }
            
            return { 
                success: true, 
                url: downloadURL, 
                offline: false 
            };
            
        } catch (error) {
            console.error('🔥 Upload profile picture error:', error);
            
            // Fallback to base64
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve({ 
                    success: true, 
                    url: e.target.result,
                    offline: true 
                });
                reader.readAsDataURL(file);
            });
        }
    }
    
    async deleteAccount(password) {
        try {
            if (!this.currentUser) {
                throw new Error('No user logged in');
            }
            
            console.log('Deleting account');
            
            // Re-authenticate
            const credential = firebase.auth.EmailAuthProvider.credential(
                this.currentUser.email, 
                password
            );
            await this.currentUser.reauthenticateWithCredential(credential);
            
            // Delete user data from Firestore
            await this.db.collection('users').doc(this.currentUser.uid).delete();
            
            // Delete from localStorage
            localStorage.removeItem(`user_${this.currentUser.uid}`);
            
            // Delete profile pictures from Storage
            try {
                const storageRef = this.storage.ref();
                const folderRef = storageRef.child(`profile_pictures/${this.currentUser.uid}`);
                const files = await folderRef.listAll();
                
                // Delete all files in folder
                const deletePromises = files.items.map(item => item.delete());
                await Promise.all(deletePromises);
                
                // Delete folder
                await folderRef.delete();
            } catch (storageError) {
                console.warn('Could not delete storage files:', storageError);
            }
            
            // Delete user from Auth
            await this.currentUser.delete();
            
            return { success: true };
            
        } catch (error) {
            console.error('🔥 Delete account error:', error);
            return { 
                success: false, 
                message: this.getFirebaseErrorMessage(error)
            };
        }
    }
    
    // ========== SYNC FUNCTIONS ==========
    async syncData() {
        if (!this.currentUser) {
            return { success: false, message: 'No user logged in' };
        }
        
        try {
            console.log('Syncing data...');
            
            // Get data from Firestore
            const firestoreDoc = await this.db.collection('users').doc(this.currentUser.uid).get();
            const firestoreData = firestoreDoc.exists ? firestoreDoc.data() : null;
            
            // Get data from localStorage
            const localData = JSON.parse(localStorage.getItem(`user_${this.currentUser.uid}`) || '{}');
            
            if (!firestoreData && !localData) {
                return { success: false, message: 'No data to sync' };
            }
            
            // Merge data (prioritize newer data)
            let mergedData;
            
            if (!firestoreData) {
                mergedData = localData;
                // Save local data to Firestore
                await this.saveUserDataToFirestore(localData);
            } else if (!localData) {
                mergedData = firestoreData;
                // Save Firestore data to localStorage
                localStorage.setItem(`user_${this.currentUser.uid}`, JSON.stringify(firestoreData));
            } else {
                // Both exist, merge them
                mergedData = this.mergeUserData(firestoreData, localData);
                
                // Save merged data to both
                await this.saveUserDataToFirestore(mergedData);
                localStorage.setItem(`user_${this.currentUser.uid}`, JSON.stringify(mergedData));
            }
            
            this.userData = mergedData;
            
            console.log('Sync completed');
            return { 
                success: true, 
                data: mergedData,
                message: 'Đã đồng bộ dữ liệu'
            };
            
        } catch (error) {
            console.error('🔥 Sync error:', error);
            return { 
                success: false, 
                message: 'Lỗi đồng bộ: ' + error.message
            };
        }
    }
    
    mergeUserData(firestoreData, localData) {
        // Simple merge - Firestore has priority for most fields
        // For expenses and categories, we need smarter merging
        
        const merged = {
            ...localData,
            ...firestoreData,
            id: this.currentUser.uid,
            email: this.currentUser.email
        };
        
        // Merge expenses by ID
        const expenseMap = new Map();
        
        // Add Firestore expenses
        (firestoreData.expenses || []).forEach(exp => {
            expenseMap.set(exp.id, exp);
        });
        
        // Add Local expenses (keep if not in Firestore or if newer)
        (localData.expenses || []).forEach(exp => {
            const existing = expenseMap.get(exp.id);
            if (!existing) {
                expenseMap.set(exp.id, exp);
            }
        });
        
        merged.expenses = Array.from(expenseMap.values());
        
        // Merge categories
        const categoryMap = new Map();
        (firestoreData.categories || []).forEach(cat => categoryMap.set(cat.id, cat));
        (localData.categories || []).forEach(cat => categoryMap.set(cat.id, cat));
        
        merged.categories = Array.from(categoryMap.values());
        
        return merged;
    }
    
    // ========== UTILITY FUNCTIONS ==========
    getFirebaseErrorMessage(error) {
        const errorMessages = {
            // Auth errors
            'auth/email-already-in-use': 'Email đã được sử dụng!',
            'auth/invalid-email': 'Email không hợp lệ!',
            'auth/operation-not-allowed': 'Tài khoản bị vô hiệu hóa!',
            'auth/weak-password': 'Mật khẩu quá yếu (ít nhất 6 ký tự)!',
            'auth/user-disabled': 'Tài khoản bị vô hiệu hóa!',
            'auth/user-not-found': 'Tài khoản không tồn tại!',
            'auth/wrong-password': 'Mật khẩu không đúng!',
            'auth/requires-recent-login': 'Vui lòng đăng nhập lại để thực hiện thao tác này!',
            'auth/too-many-requests': 'Quá nhiều lần thử, vui lòng thử lại sau!',
            
            // Firestore errors
            'permission-denied': 'Không có quyền truy cập!',
            'unavailable': 'Dịch vụ không khả dụng, vui lòng thử lại!',
            
            // Storage errors
            'storage/unauthorized': 'Không có quyền upload file!',
            'storage/canceled': 'Upload bị hủy!',
            'storage/unknown': 'Lỗi không xác định!'
        };
        
        return errorMessages[error.code] || error.message || 'Có lỗi xảy ra!';
    }
    
    isOnline() {
        return navigator.onLine;
    }
    
    setupNetworkListener(callback) {
        window.addEventListener('online', async () => {
            console.log('🌐 Online - Syncing data...');
            if (this.currentUser) {
                const result = await this.syncData();
                if (callback) callback('online', result);
            }
        });
        
        window.addEventListener('offline', () => {
            console.log('🌐 Offline - Using local data');
            if (callback) callback('offline', null);
        });
    }
    
    // Get current user data
    getCurrentUserData() {
        return this.userData;
    }
    
    // Set callback for user changes
    setUserChangedCallback(callback) {
        this.onUserChanged = callback;
    }
}

// Create global instance
window.firebaseService = new FirebaseService();
