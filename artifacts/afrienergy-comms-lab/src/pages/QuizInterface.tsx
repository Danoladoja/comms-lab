import { useState, useEffect } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { quizzes } from '@/data/mock';
import { Button } from '@/components/ui/button';
import { X, CheckCircle2, AlertCircle, ArrowRight, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function QuizInterface() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const quiz = quizzes[0]; // using mock for now

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  if (!quiz) return <div>Quiz not found</div>;

  const currentQuestion = quiz.questions[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / quiz.questions.length) * 100;
  
  const handleSelect = (answer: string) => {
    if (isSubmitted) return;
    setSelectedAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: answer
    }));
  };

  const handleNext = () => {
    if (currentQuestionIndex < quiz.questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      // Calculate score
      let correct = 0;
      quiz.questions.forEach(q => {
        if (selectedAnswers[q.id] === q.correctAnswer) correct++;
      });
      setScore(correct);
      setIsSubmitted(true);
    }
  };

  const isPass = score / quiz.questions.length >= 0.7; // 70% passing grade

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="font-bold text-lg">{quiz.title}</div>
          <Button variant="ghost" size="icon" onClick={() => setLocation('/courses/course-1')}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        {!isSubmitted && (
          <div className="h-1 w-full bg-muted">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 md:py-16 max-w-3xl flex flex-col justify-center">
        
        <AnimatePresence mode="wait">
          {!isSubmitted ? (
            <motion.div
              key={currentQuestionIndex}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="w-full"
            >
              <div className="text-sm text-muted-foreground font-medium mb-4">
                Question {currentQuestionIndex + 1} of {quiz.questions.length}
              </div>
              <h2 className="text-2xl md:text-3xl font-display font-bold mb-8">
                {currentQuestion.text}
              </h2>

              <div className="space-y-4">
                {currentQuestion.options?.map((option, i) => {
                  const isSelected = selectedAnswers[currentQuestion.id] === option;
                  return (
                    <button
                      key={i}
                      onClick={() => handleSelect(option)}
                      className={`w-full text-left p-5 rounded-xl border-2 transition-all flex items-center justify-between ${
                        isSelected 
                          ? 'border-primary bg-primary/5 shadow-sm' 
                          : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20'
                      }`}
                    >
                      <span className="font-medium text-lg">{option}</span>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                      }`}>
                        {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-12 flex justify-end">
                <Button 
                  size="lg" 
                  onClick={handleNext}
                  disabled={!selectedAnswers[currentQuestion.id]}
                  className="px-8"
                >
                  {currentQuestionIndex === quiz.questions.length - 1 ? 'Submit Quiz' : 'Next Question'} 
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full bg-card border border-border rounded-3xl p-8 md:p-12 text-center shadow-xl relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 w-full h-2 ${isPass ? 'bg-secondary' : 'bg-destructive'}`} />
              
              <div className="flex justify-center mb-6">
                {isPass ? (
                  <div className="w-20 h-20 bg-secondary/10 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-12 h-12 text-secondary" />
                  </div>
                ) : (
                  <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center">
                    <AlertCircle className="w-12 h-12 text-destructive" />
                  </div>
                )}
              </div>
              
              <h2 className="text-4xl font-display font-bold mb-2">
                {isPass ? 'Congratulations!' : 'Keep trying!'}
              </h2>
              <p className="text-xl text-muted-foreground mb-8">
                You scored {score} out of {quiz.questions.length} ({(score / quiz.questions.length * 100).toFixed(0)}%)
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                {!isPass && (
                  <Button size="lg" variant="outline" onClick={() => {
                    setIsSubmitted(false);
                    setCurrentQuestionIndex(0);
                    setSelectedAnswers({});
                  }}>
                    <RotateCcw className="w-4 h-4 mr-2" /> Retry Quiz
                  </Button>
                )}
                <Button size="lg" asChild>
                  <Link href="/courses/course-1">Return to Course</Link>
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
