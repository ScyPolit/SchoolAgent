// Derived from LibreChat v0.8.1, MIT. See third_party/librechat/NOTICE.md.
import { useEffect, useState } from 'react';

export const useAutoScroll = ({ ref, content, isSubmitting }) => {
  const [userScrolled, setUserScrolled] = useState(false);
  useEffect(() => {
    const scrollContainer = ref.current;
    if (!scrollContainer) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      setUserScrolled(scrollHeight - scrollTop - clientHeight >= 50);
    };
    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [ref]);
  useEffect(() => {
    const scrollContainer = ref.current;
    if (!scrollContainer || !isSubmitting || userScrolled) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [content, isSubmitting, userScrolled, ref]);
  return { userScrolled };
};
