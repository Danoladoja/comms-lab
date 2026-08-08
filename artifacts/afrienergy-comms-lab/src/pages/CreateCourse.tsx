import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, ChevronRight, Upload, Plus, GripVertical, Settings, Globe } from 'lucide-react';
import { Link, useLocation } from 'wouter';

export default function CreateCourse() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [isPublishing, setIsPublishing] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');

  // Mock modules
  const [modules, setModules] = useState([
    { id: '1', title: 'Module 1: Introduction', lessons: ['Welcome & Overview'] }
  ]);

  const handlePublish = () => {
    setIsPublishing(true);
    // Simulate API call
    setTimeout(() => {
      setLocation('/instructor');
    }, 1500);
  };

  const addModule = () => {
    setModules([...modules, { id: Date.now().toString(), title: `Module ${modules.length + 1}: New Module`, lessons: [] }]);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="border-b border-border bg-card sticky top-[72px] z-10 shadow-sm">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/instructor">Cancel</Link>
            </Button>
            <div className="h-6 w-px bg-border"></div>
            <span className="font-medium">{title || 'Draft Course'}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">Save Draft</Button>
            {step === 3 ? (
              <Button size="sm" onClick={handlePublish} disabled={isPublishing}>
                {isPublishing ? 'Publishing...' : 'Publish Course'}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Next Step <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 mt-8 max-w-4xl">
        {/* Progress Bar */}
        <div className="mb-10 flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-muted z-0"></div>
          <div 
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary z-0 transition-all duration-300"
            style={{ width: `${((step - 1) / 2) * 100}%` }}
          ></div>
          
          {[1, 2, 3].map((num) => (
            <div key={num} className="relative z-10 flex flex-col items-center">
              <button
                onClick={() => setStep(num)}
                disabled={num > step}
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors ${
                  step >= num 
                    ? 'bg-primary border-primary text-primary-foreground' 
                    : 'bg-card border-muted-foreground text-muted-foreground'
                }`}
              >
                {step > num ? <CheckCircle2 className="w-6 h-6" /> : num}
              </button>
              <span className={`mt-2 text-xs font-medium absolute -bottom-6 w-24 text-center ${
                step >= num ? 'text-foreground' : 'text-muted-foreground'
              }`}>
                {num === 1 ? 'Basic Info' : num === 2 ? 'Curriculum' : 'Settings'}
              </span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-6 md:p-8 mt-12">
          
          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              <div>
                <h2 className="text-2xl font-bold mb-2">Course Information</h2>
                <p className="text-muted-foreground">Let's start with the basics. What are you teaching?</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Course Title</Label>
                  <Input 
                    id="title" 
                    placeholder="e.g. Advanced Financial Modeling" 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea 
                    id="description" 
                    placeholder="What will students learn?" 
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <select id="category" className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                      <option>Technology</option>
                      <option>Business</option>
                      <option>Energy</option>
                      <option>Communications</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="level">Level</Label>
                    <select id="level" className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                      <option>Beginner</option>
                      <option>Intermediate</option>
                      <option>Advanced</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Curriculum */}
          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex justify-between items-end">
                <div>
                  <h2 className="text-2xl font-bold mb-2">Curriculum Builder</h2>
                  <p className="text-muted-foreground">Structure your course into modules and lessons.</p>
                </div>
                <Button onClick={addModule} variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-2" /> Add Module
                </Button>
              </div>

              <div className="space-y-6">
                {modules.map((mod, index) => (
                  <div key={mod.id} className="border border-border rounded-xl bg-muted/20 overflow-hidden">
                    <div className="p-4 bg-muted/40 border-b border-border flex items-center gap-3">
                      <GripVertical className="w-5 h-5 text-muted-foreground cursor-grab" />
                      <Input defaultValue={mod.title} className="font-bold bg-transparent border-none px-0 focus-visible:ring-0 shadow-none text-lg" />
                    </div>
                    <div className="p-4 space-y-3">
                      {mod.lessons.map((lesson, lIndex) => (
                        <div key={lIndex} className="flex items-center gap-3 bg-card border border-border rounded-lg p-3 group">
                          <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab opacity-50 group-hover:opacity-100" />
                          <div className="flex-1 text-sm font-medium">{lesson}</div>
                          <Settings className="w-4 h-4 text-muted-foreground hover:text-foreground cursor-pointer" />
                        </div>
                      ))}
                      <Button variant="ghost" size="sm" className="text-primary mt-2 w-full border border-dashed border-primary/30">
                        <Plus className="w-4 h-4 mr-2" /> Add Lesson (Video, Text, Quiz)
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Settings */}
          {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              <div>
                <h2 className="text-2xl font-bold mb-2">Final Settings</h2>
                <p className="text-muted-foreground">Set pricing and visibility before publishing.</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-4">
                  <Label>Course Thumbnail</Label>
                  <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:bg-muted/50 transition-colors cursor-pointer flex flex-col items-center">
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                      <Upload className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <div className="font-medium mb-1">Click to upload or drag and drop</div>
                    <div className="text-sm text-muted-foreground">SVG, PNG, JPG or GIF (max. 800x400px)</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <Label htmlFor="price">Pricing ($)</Label>
                    <Input 
                      id="price" 
                      type="number" 
                      placeholder="e.g. 49.99" 
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Set to 0 for a free course.</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Visibility</Label>
                    <div className="flex gap-4">
                      <label className="flex-1 flex items-center gap-3 border border-primary bg-primary/5 rounded-lg p-4 cursor-pointer">
                        <input type="radio" name="visibility" className="text-primary focus:ring-primary" defaultChecked />
                        <div>
                          <div className="font-medium flex items-center gap-2"><Globe className="w-4 h-4" /> Public</div>
                          <div className="text-xs text-muted-foreground">Visible to everyone</div>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
