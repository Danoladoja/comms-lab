import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { courses } from '@/data/mock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Lock, ShieldCheck, ArrowRight, CreditCard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function EnrollmentFlow() {
  const { id } = useParams();
  const course = courses.find(c => c.id === id);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!course) return <div>Course not found</div>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    // Simulate payment processing
    setTimeout(() => {
      setIsProcessing(false);
      setIsSuccess(true);
    }, 2000);
  };

  return (
    <div className="min-h-[100dvh] bg-muted/30 py-12 px-4 flex flex-col justify-center">
      <div className="container mx-auto max-w-5xl">
        <Link href={`/courses/${course.id}`} className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-8">
          ← Back to Course
        </Link>

        <AnimatePresence mode="wait">
          {!isSuccess ? (
            <motion.div 
              key="checkout"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start"
            >
              {/* Checkout Form */}
              <div className="lg:col-span-3 bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
                <div className="bg-muted/50 p-6 border-b border-border">
                  <h1 className="text-2xl font-bold font-display">Secure Checkout</h1>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-8">
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2"><Lock className="w-4 h-4 text-primary" /> Account Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First Name</Label>
                        <Input id="firstName" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last Name</Label>
                        <Input id="lastName" required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address</Label>
                      <Input id="email" type="email" required />
                    </div>
                  </div>

                  <hr className="border-border" />

                  <div className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Payment Method</h3>
                    <div className="space-y-4 border border-primary bg-primary/5 rounded-xl p-4">
                      <div className="space-y-2">
                        <Label htmlFor="cardName">Name on Card</Label>
                        <Input id="cardName" required className="bg-card" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cardNumber">Card Number</Label>
                        <Input id="cardNumber" placeholder="0000 0000 0000 0000" required className="bg-card" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="expiry">Expiry Date</Label>
                          <Input id="expiry" placeholder="MM/YY" required className="bg-card" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="cvc">CVC</Label>
                          <Input id="cvc" placeholder="123" required className="bg-card" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <Button type="submit" size="lg" className="w-full h-14 text-lg font-bold" disabled={isProcessing}>
                    {isProcessing ? 'Processing Payment...' : `Pay $${course.price}`}
                  </Button>

                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mt-4">
                    <ShieldCheck className="w-4 h-4 text-green-600" />
                    Payments are secure and encrypted
                  </div>
                </form>
              </div>

              {/* Order Summary */}
              <div className="lg:col-span-2 lg:sticky lg:top-8">
                <div className="bg-card border border-border rounded-2xl shadow-xl p-6">
                  <h3 className="text-lg font-bold mb-6">Order Summary</h3>
                  
                  <div className="flex gap-4 mb-6">
                    <img src={course.thumbnail} alt={course.title} className="w-24 h-20 object-cover rounded-lg border border-border" />
                    <div>
                      <div className="font-bold leading-tight mb-1">{course.title}</div>
                      <div className="text-sm text-muted-foreground">{course.level} • {course.duration}</div>
                    </div>
                  </div>

                  <hr className="border-border mb-6" />

                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Original Price</span>
                      <span>${course.price}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Discount</span>
                      <span>-$0.00</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg pt-3 border-t border-border">
                      <span>Total</span>
                      <span>${course.price}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-secondary shrink-0" />
                      <span className="text-sm text-muted-foreground">Full lifetime access to course materials</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-secondary shrink-0" />
                      <span className="text-sm text-muted-foreground">Access to upcoming live sessions</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-secondary shrink-0" />
                      <span className="text-sm text-muted-foreground">Verified certificate of completion</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border rounded-3xl shadow-2xl p-12 text-center max-w-2xl mx-auto"
            >
              <div className="w-24 h-24 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-12 h-12 text-secondary" />
              </div>
              <h2 className="text-4xl font-display font-bold mb-4">You're In!</h2>
              <p className="text-xl text-muted-foreground mb-8">
                Your payment was successful. Welcome to <span className="font-bold text-foreground">{course.title}</span>.
              </p>
              
              <div className="bg-muted/50 rounded-xl p-6 mb-8 text-left border border-border">
                <h4 className="font-bold mb-4">What's next?</h4>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">1</div>
                    <span className="text-sm">Check your email for the receipt and login details.</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">2</div>
                    <span className="text-sm">Head over to your Learner Dashboard.</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">3</div>
                    <span className="text-sm">Start your first module!</span>
                  </li>
                </ul>
              </div>

              <Button size="lg" asChild className="w-full sm:w-auto px-12">
                <Link href="/dashboard">Go to Dashboard <ArrowRight className="w-4 h-4 ml-2" /></Link>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
