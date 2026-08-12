/**
 * Faculty shown on the About page.
 *
 * This is editorial content the team owns, not mock data — it used to live in
 * `data/mock.ts` alongside fake courses and fake join links, which meant the
 * public site was rendering placeholders. Edit this file to change the page.
 * When faculty become first-class records with their own admin screen, this
 * moves behind the API.
 */
import instructor1 from '@assets/instructor-1.jpg';
import instructor2 from '@assets/instructor-2.jpg';
import instructor3 from '@assets/instructor-3.jpg';

export type FacultyMember = {
  id: string;
  name: string;
  title: string;
  bio: string;
  imageUrl: string;
};

export const faculty: FacultyMember[] = [
  {
    id: 'inst-1',
    name: 'Amina Ndlovu',
    title: 'Energy Transition Specialist',
    bio: 'Amina has 15 years of experience leading renewable energy initiatives across East Africa. She specializes in solar micro-grid policies and energy economics.',
    imageUrl: instructor1
  },
  {
    id: 'inst-2',
    name: 'Kwame Osei',
    title: 'VP of Engineering, TechBuild Africa',
    bio: 'Kwame is a software architect and educator passionate about building resilient digital infrastructure for emerging markets.',
    imageUrl: instructor2
  },
  {
    id: 'inst-3',
    name: 'Sarah Adeyemi',
    title: 'Communications Strategist',
    bio: 'Sarah helps leaders craft compelling narratives. She has consulted for top Pan-African enterprises and international NGOs.',
    imageUrl: instructor3,
  }
];
