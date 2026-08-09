export interface Instructor {
  id: string;
  name: string;
  title: string;
  bio: string;
  imageUrl: string;
  courseCount: number;
  studentCount: number;
}

export interface Course {
  id: string;
  title: string;
  instructorId: string;
  category: string;
  level: string;
  price: number;
  rating: number;
  learnerCount: number;
  thumbnail: string;
  duration: string;
  description: string;
  whatYouWillLearn: string[];
}

export interface Module {
  id: string;
  courseId: string;
  title: string;
  order: number;
}

export interface Lesson {
  id: string;
  moduleId: string;
  title: string;
  type: 'video' | 'text' | 'quiz';
  duration?: string;
  order: number;
  isCompleted?: boolean;
}

export interface LiveSession {
  id: string;
  title: string;
  instructorId: string;
  courseId?: string;
  date: string;
  duration: string;
  platform: 'Zoom' | 'Google Meet';
  joinUrl: string;
  isUpcoming: boolean;
}

export interface Quiz {
  id: string;
  lessonId: string;
  title: string;
  questions: {
    id: string;
    text: string;
    type: 'multiple_choice' | 'true_false';
    options?: string[];
    correctAnswer: string;
  }[];
}

import instructor1 from '@assets/instructor-1.jpg';
import instructor2 from '@assets/instructor-2.jpg';
import instructor3 from '@assets/instructor-3.jpg';
import courseEnergy from '@assets/course-energy.jpg';
import courseTech from '@assets/course-tech.jpg';
import courseBusiness from '@assets/course-business.jpg';
import courseComms from '@assets/course-comms.jpg';

export interface Program {
  id: string;
  tag: string;       // focus area label
  title: string;
  description: string;
  date: string;      // e.g. 'Nov 2026'
  format: string;    // e.g. 'Cohort' | 'Masterclass' | 'Intensive'
  duration: string;  // e.g. '4 weeks'
  thumbnail: string;
  instructorId: string;
}

export const programs: Program[] = [
  {
    id: 'prog-1',
    tag: 'Strategic Energy Communications',
    title: 'Energy Narrative Lab',
    description: 'A cohort workshop on building compelling energy stories for policy, media, and public audiences.',
    date: 'Nov 2026',
    format: 'Cohort',
    duration: '4 weeks',
    thumbnail: courseComms,
    instructorId: 'inst-3',
  },
  {
    id: 'prog-2',
    tag: 'Energy Transition & Policy',
    title: "Africa's Just Transition: Policy Briefing Series",
    description: "A masterclass series on the regulatory and political landscape shaping Africa's energy transition.",
    date: 'Jan 2027',
    format: 'Masterclass',
    duration: '6 sessions',
    thumbnail: courseEnergy,
    instructorId: 'inst-1',
  },
  {
    id: 'prog-3',
    tag: 'Advocacy & Stakeholder Influence',
    title: 'Advocacy by Design',
    description: 'An intensive on designing advocacy campaigns that move decision-makers and mobilise coalitions.',
    date: 'Mar 2027',
    format: 'Intensive',
    duration: '3 days',
    thumbnail: courseBusiness,
    instructorId: 'inst-3',
  },
];

export const instructors: Instructor[] = [
  {
    id: 'inst-1',
    name: 'Amina Ndlovu',
    title: 'Energy Transition Specialist',
    bio: 'Amina has 15 years of experience leading renewable energy initiatives across East Africa. She specializes in solar micro-grid policies and energy economics.',
    imageUrl: instructor1,
    courseCount: 3,
    studentCount: 1420
  },
  {
    id: 'inst-2',
    name: 'Kwame Osei',
    title: 'VP of Engineering, TechBuild Africa',
    bio: 'Kwame is a software architect and educator passionate about building resilient digital infrastructure for emerging markets.',
    imageUrl: instructor2,
    courseCount: 5,
    studentCount: 3200
  },
  {
    id: 'inst-3',
    name: 'Sarah Adeyemi',
    title: 'Communications Strategist',
    bio: 'Sarah helps leaders craft compelling narratives. She has consulted for top Pan-African enterprises and international NGOs.',
    imageUrl: instructor3,
    courseCount: 2,
    studentCount: 850
  }
];

export const courses: Course[] = [
  {
    id: 'course-1',
    title: 'Renewable Energy Economics in Africa',
    instructorId: 'inst-1',
    category: 'Energy',
    level: 'Intermediate',
    price: 49.99,
    rating: 4.8,
    learnerCount: 1205,
    thumbnail: courseEnergy,
    duration: '4 Weeks',
    description: 'Understand the financial models driving the solar and wind energy transition across the continent. Perfect for project managers and investors.',
    whatYouWillLearn: [
      'Financial modeling for micro-grids',
      'Policy frameworks in East and West Africa',
      'Cost-benefit analysis of renewable sources',
      'Navigating international green funding'
    ]
  },
  {
    id: 'course-2',
    title: 'Building Resilient Tech Infrastructures',
    instructorId: 'inst-2',
    category: 'Technology',
    level: 'Advanced',
    price: 79.99,
    rating: 4.9,
    learnerCount: 2100,
    thumbnail: courseTech,
    duration: '6 Weeks',
    description: 'Learn how to architect systems that withstand connectivity drops and scale massively across diverse geographical regions.',
    whatYouWillLearn: [
      'Offline-first architecture principles',
      'Distributed systems in low-bandwidth areas',
      'Cloud optimization and cost management',
      'Security for emerging market fintechs'
    ]
  },
  {
    id: 'course-3',
    title: 'Strategic Leadership for Scaling Startups',
    instructorId: 'inst-3',
    category: 'Business',
    level: 'Beginner',
    price: 39.99,
    rating: 4.7,
    learnerCount: 850,
    thumbnail: courseBusiness,
    duration: '3 Weeks',
    description: 'A masterclass in leading teams, managing investors, and scaling operations from seed to Series A in African markets.',
    whatYouWillLearn: [
      'Building a strong company culture',
      'Effective investor communication',
      'Operational scaling strategies',
      'Crisis management for startups'
    ]
  },
  {
    id: 'course-4',
    title: 'Executive Communications & Storytelling',
    instructorId: 'inst-3',
    category: 'Communications',
    level: 'Intermediate',
    price: 59.99,
    rating: 4.9,
    learnerCount: 1420,
    thumbnail: courseComms,
    duration: '4 Weeks',
    description: 'Master the art of storytelling to captivate audiences, pitch to investors, and lead with empathy.',
    whatYouWillLearn: [
      'The neuroscience of storytelling',
      'Structuring the perfect pitch',
      'Public speaking and presence',
      'Writing compelling executive summaries'
    ]
  }
];

export const modules: Module[] = [
  { id: 'mod-1', courseId: 'course-1', title: 'Introduction to Energy Markets', order: 1 },
  { id: 'mod-2', courseId: 'course-1', title: 'Solar Micro-grids Financials', order: 2 },
  { id: 'mod-3', courseId: 'course-1', title: 'Policy & Regulatory Landscapes', order: 3 },
];

export const lessons: Lesson[] = [
  { id: 'les-1', moduleId: 'mod-1', title: 'Welcome to the Course', type: 'video', duration: '5:00', order: 1, isCompleted: true },
  { id: 'les-2', moduleId: 'mod-1', title: 'Understanding the African Energy Deficit', type: 'text', order: 2, isCompleted: true },
  { id: 'les-3', moduleId: 'mod-1', title: 'Key Players in the Market', type: 'video', duration: '12:30', order: 3, isCompleted: false },
  { id: 'les-4', moduleId: 'mod-1', title: 'Module 1 Quiz', type: 'quiz', order: 4, isCompleted: false },
  
  { id: 'les-5', moduleId: 'mod-2', title: 'Capex vs Opex in Solar', type: 'video', duration: '18:45', order: 1 },
  { id: 'les-6', moduleId: 'mod-2', title: 'Financial Modeling Exercise', type: 'text', order: 2 },
];

export const liveSessions: LiveSession[] = [
  {
    id: 'ls-1',
    title: 'Crafting the Energy Brief: Writing for Policy Audiences',
    instructorId: 'inst-3',
    date: '2026-11-08T14:00:00Z',
    duration: '60 min',
    platform: 'Zoom',
    joinUrl: 'https://zoom.us/j/98765432100',
    isUpcoming: true
  },
  {
    id: 'ls-2',
    title: 'Framing the Just Transition: Communicating Policy Change to Communities',
    instructorId: 'inst-1',
    date: '2026-11-20T16:00:00Z',
    duration: '90 min',
    platform: 'Google Meet',
    joinUrl: 'https://meet.google.com/abc-defg-hij',
    isUpcoming: true
  },
  {
    id: 'ls-3',
    title: 'Running an Advocacy Campaign with Limited Resources',
    instructorId: 'inst-3',
    date: '2026-10-15T10:00:00Z',
    duration: '75 min',
    platform: 'Zoom',
    joinUrl: '#',
    isUpcoming: false
  }
];

export const quizzes: Quiz[] = [
  {
    id: 'quiz-1',
    lessonId: 'les-4',
    title: 'Module 1 Assessment',
    questions: [
      {
        id: 'q-1',
        text: 'Which of the following is the primary challenge for large-scale energy projects in rural areas?',
        type: 'multiple_choice',
        options: ['High initial capital expenditure (Capex)', 'Lack of sunlight', 'Oversupply of components', 'Excessive operational expenditure (Opex)'],
        correctAnswer: 'High initial capital expenditure (Capex)'
      },
      {
        id: 'q-2',
        text: 'Micro-grids are entirely dependent on national grid infrastructure.',
        type: 'true_false',
        options: ['True', 'False'],
        correctAnswer: 'False'
      },
      {
        id: 'q-3',
        text: 'What percentage of sub-Saharan Africa currently lacks access to reliable electricity?',
        type: 'multiple_choice',
        options: ['10-20%', '30-40%', '50-60%', 'Over 80%'],
        correctAnswer: '50-60%'
      }
    ]
  }
];
