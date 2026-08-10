import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  getDocs
} from 'firebase/firestore';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  User as FirebaseUser
} from 'firebase/auth';
import { db, auth, googleProvider } from './firebase';
import {
  ContentItem,
  SummaryItem,
  QuizItem,
  StudyTask,
  CustomTest,
  UserProfile
} from '../types';
import {
  initialContentItems,
  initialSummaryItems,
  initialQuizItems,
  initialCustomTests,
  initialStudyTasks,
  initialUserProfile
} from '../data/initialData';

// Collection References
const usersCol = collection(db, 'users');
const contentCol = collection(db, 'content_items');
const summaryCol = collection(db, 'summaries');
const quizCol = collection(db, 'quizzes');
const taskCol = collection(db, 'study_tasks');
const testCol = collection(db, 'exam_reminders');

// Helper to sanitize objects for Firestore (removes undefined values to prevent Firestore setDoc errors)
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as any;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as any;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const cleanObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleanObj[key] = sanitizeForFirestore(value);
      }
    }
    return cleanObj as T;
  }
  return data;
}

// Helper to seed initial data if collections are empty
export async function seedInitialDataIfEmpty() {
  try {
    const contentSnap = await getDocs(contentCol);
    if (contentSnap.empty) {
      for (const item of initialContentItems) {
        await setDoc(doc(db, 'content_items', item.id), sanitizeForFirestore(item));
      }
    }

    const summarySnap = await getDocs(summaryCol);
    if (summarySnap.empty) {
      for (const item of initialSummaryItems) {
        await setDoc(doc(db, 'summaries', item.id), sanitizeForFirestore(item));
      }
    }

    const quizSnap = await getDocs(quizCol);
    if (quizSnap.empty) {
      for (const item of initialQuizItems) {
        await setDoc(doc(db, 'quizzes', item.id), sanitizeForFirestore(item));
      }
    }

    const taskSnap = await getDocs(taskCol);
    if (taskSnap.empty) {
      for (const item of initialStudyTasks) {
        await setDoc(doc(db, 'study_tasks', item.id), sanitizeForFirestore(item));
      }
    }

    const testSnap = await getDocs(testCol);
    if (testSnap.empty) {
      for (const item of initialCustomTests) {
        await setDoc(doc(db, 'exam_reminders', item.id), sanitizeForFirestore(item));
      }
    }

    // Save default initial user profile if users empty
    const userSnap = await getDocs(usersCol);
    if (userSnap.empty) {
      const defaultUserDoc = {
        ...initialUserProfile,
        uid: 'user_default',
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString()
      };
      await setDoc(doc(db, 'users', 'user_default'), sanitizeForFirestore(defaultUserDoc));
    }
  } catch (err) {
    console.error('Error seeding initial Firestore data:', err);
  }
}

// User Profile Functions
export async function saveUserProfile(user: UserProfile) {
  try {
    const docId = user.email ? user.email.replace(/[^a-zA-Z0-9]/g, '_') : 'user_default';
    const userData = {
      ...user,
      lastActive: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', docId), sanitizeForFirestore(userData), { merge: true });
  } catch (err) {
    console.error('Firestore saveUserProfile error:', err);
  }
}

export function subscribeUserProfile(docId: string, callback: (user: UserProfile) => void) {
  const safeDocId = docId.replace(/[^a-zA-Z0-9]/g, '_');
  return onSnapshot(doc(db, 'users', safeDocId), (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data() as UserProfile);
    }
  }, (err) => console.error('Firestore subscribeUserProfile error:', err));
}

export function subscribeAllUsers(callback: (users: UserProfile[]) => void) {
  return onSnapshot(usersCol, (snapshot) => {
    const users: UserProfile[] = snapshot.docs.map((d) => d.data() as UserProfile);
    callback(users);
  }, (err) => console.error('Firestore subscribeAllUsers error:', err));
}

// Authentication Helpers
export async function registerWithEmailPassword(
  name: string,
  email: string,
  pass: string,
  gradeLevel?: string,
  targetExam?: string
): Promise<UserProfile> {
  let uid = '';
  try {
    const res = await createUserWithEmailAndPassword(auth, email, pass);
    uid = res.user.uid;
  } catch (err) {
    console.warn('Firebase Auth createUserWithEmailAndPassword note:', err);
  }

  const newDocId = email.replace(/[^a-zA-Z0-9]/g, '_');
  const userProfile: UserProfile = {
    id: uid || `usr_${Date.now()}`,
    name: name || 'طالب جديد',
    email: email,
    avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
    isLoggedIn: true,
    provider: 'email',
    gradeLevel: gradeLevel || 'المرحلة الثانوية',
    targetExam: targetExam || 'اختبار القدرات والتحصيلي',
    streakDays: 1,
    points: 100,
    level: 'طالب جديد',
    joinedDate: new Date().toISOString().split('T')[0]
  };

  await setDoc(doc(db, 'users', newDocId), userProfile, { merge: true });
  return userProfile;
}

export async function loginWithEmailPassword(email: string, pass: string): Promise<UserProfile> {
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    console.warn('Firebase Auth signInWithEmailAndPassword note:', err);
  }

  const docId = email.replace(/[^a-zA-Z0-9]/g, '_');
  const userDocRef = doc(db, 'users', docId);
  const snap = await getDoc(userDocRef);

  if (snap.exists()) {
    const profile = snap.data() as UserProfile;
    const updatedProfile: UserProfile = { ...profile, isLoggedIn: true };
    await saveUserProfile(updatedProfile);
    return updatedProfile;
  } else {
    // Create new profile if doc doesn't exist
    const newProfile: UserProfile = {
      id: `usr_${Date.now()}`,
      name: email.split('@')[0],
      email: email,
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
      isLoggedIn: true,
      provider: 'email',
      gradeLevel: 'المرحلة الثانوية',
      targetExam: 'اختبار القدرات والتحصيلي',
      streakDays: 1,
      points: 100,
      level: 'طالب جديد',
      joinedDate: new Date().toISOString().split('T')[0]
    };
    await saveUserProfile(newProfile);
    return newProfile;
  }
}

// Authentication Helpers
export async function loginWithGooglePopup(): Promise<UserProfile | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const fbUser = result.user;
    const email = fbUser.email || `google_user_${Date.now()}@gmail.com`;
    const docId = email.replace(/[^a-zA-Z0-9]/g, '_');
    
    const userDocRef = doc(db, 'users', docId);
    const snap = await getDoc(userDocRef);

    let userProfile: UserProfile;
    if (snap.exists()) {
      userProfile = { ...(snap.data() as UserProfile), isLoggedIn: true, provider: 'google' };
    } else {
      userProfile = {
        id: fbUser.uid || `usr_${Date.now()}`,
        name: fbUser.displayName || 'طالب Google جديد',
        email: email,
        avatarUrl: fbUser.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
        provider: 'google',
        gradeLevel: 'المرحلة الثانوية',
        targetExam: 'اختبار القدرات والتحصيلي',
        streakDays: 1,
        points: 100,
        level: 'طالب متميز',
        joinedDate: new Date().toISOString().split('T')[0],
        isLoggedIn: true
      };
    }
    await saveUserProfile(userProfile);
    return userProfile;
  } catch (err) {
    console.warn('Google Auth popup error or canceled:', err);
    return null;
  }
}

export async function logoutUserAuth() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Firebase Auth signOut error:', err);
  }
}

export function listenAuthState(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}

// Subscribe Functions
export function subscribeContentItems(callback: (items: ContentItem[]) => void) {
  return onSnapshot(contentCol, (snapshot) => {
    const items: ContentItem[] = snapshot.docs.map((d) => d.data() as ContentItem);
    callback(items);
  }, (err) => console.error('Firestore content subscribe error:', err));
}

export function subscribeSummaries(callback: (items: SummaryItem[]) => void) {
  return onSnapshot(summaryCol, (snapshot) => {
    const items: SummaryItem[] = snapshot.docs.map((d) => d.data() as SummaryItem);
    callback(items);
  }, (err) => console.error('Firestore summaries subscribe error:', err));
}

export function subscribeQuizzes(callback: (items: QuizItem[]) => void) {
  return onSnapshot(quizCol, (snapshot) => {
    const items: QuizItem[] = snapshot.docs.map((d) => d.data() as QuizItem);
    callback(items);
  }, (err) => console.error('Firestore quizzes subscribe error:', err));
}

export function subscribeTasks(callback: (items: StudyTask[]) => void) {
  return onSnapshot(taskCol, (snapshot) => {
    const items: StudyTask[] = snapshot.docs.map((d) => d.data() as StudyTask);
    callback(items);
  }, (err) => console.error('Firestore tasks subscribe error:', err));
}

export function subscribeCustomTests(callback: (items: CustomTest[]) => void) {
  return onSnapshot(testCol, (snapshot) => {
    const items: CustomTest[] = snapshot.docs.map((d) => d.data() as CustomTest);
    callback(items);
  }, (err) => console.error('Firestore custom tests subscribe error:', err));
}

// Mutation Functions
export async function saveContentItem(item: ContentItem) {
  try {
    await setDoc(doc(db, 'content_items', item.id), sanitizeForFirestore(item));
  } catch (err) {
    console.warn('Firestore saveContentItem error (saved in local memory):', err);
  }
}

export async function deleteContentItemDoc(id: string) {
  try {
    await deleteDoc(doc(db, 'content_items', id));
  } catch (err) {
    console.warn('Firestore deleteContentItemDoc error:', err);
  }
}

export async function saveSummaryItem(item: SummaryItem) {
  try {
    await setDoc(doc(db, 'summaries', item.id), sanitizeForFirestore(item));
  } catch (err) {
    console.warn('Firestore saveSummaryItem error (saved in local memory):', err);
  }
}

export async function deleteSummaryItemDoc(id: string) {
  try {
    await deleteDoc(doc(db, 'summaries', id));
  } catch (err) {
    console.warn('Firestore deleteSummaryItemDoc error:', err);
  }
}

export async function saveQuizItem(item: QuizItem) {
  try {
    await setDoc(doc(db, 'quizzes', item.id), sanitizeForFirestore(item));
  } catch (err) {
    console.warn('Firestore saveQuizItem error (saved in local memory):', err);
  }
}

export async function deleteQuizItemDoc(id: string) {
  try {
    await deleteDoc(doc(db, 'quizzes', id));
  } catch (err) {
    console.warn('Firestore deleteQuizItemDoc error:', err);
  }
}

export async function saveTaskItem(item: StudyTask) {
  try {
    await setDoc(doc(db, 'study_tasks', item.id), sanitizeForFirestore(item));
  } catch (err) {
    console.warn('Firestore saveTaskItem error (saved in local memory):', err);
  }
}

export async function deleteTaskItemDoc(id: string) {
  try {
    await deleteDoc(doc(db, 'study_tasks', id));
  } catch (err) {
    console.warn('Firestore deleteTaskItemDoc error:', err);
  }
}

export async function saveCustomTestItem(item: CustomTest) {
  try {
    await setDoc(doc(db, 'exam_reminders', item.id), sanitizeForFirestore(item));
  } catch (err) {
    console.warn('Firestore saveCustomTestItem error (saved in local memory):', err);
  }
}

export async function deleteCustomTestItemDoc(id: string) {
  try {
    await deleteDoc(doc(db, 'exam_reminders', id));
  } catch (err) {
    console.warn('Firestore deleteCustomTestItemDoc error:', err);
  }
}
