import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import AuthenticatedImage from './AuthenticatedImage';

const ImageLightbox = ({ images, currentIndex, onClose, onPrevious, onNext }) => {
    const isOpen = currentIndex != null && images.length > 0;

    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowLeft') onPrevious();
            if (event.key === 'ArrowRight') onNext();
        };

        document.addEventListener('keydown', handleKeyDown);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen, onClose, onPrevious, onNext]);

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[2000] bg-black/90 flex items-center justify-center px-6 py-10"
            onClick={onClose}
        >
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                }}
                className="absolute top-5 right-5 text-white/80 hover:text-white transition"
                aria-label="Close image preview"
            >
                <X size={28} />
            </button>

            {images.length > 1 && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onPrevious();
                    }}
                    className="absolute left-5 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition"
                    aria-label="Previous image"
                >
                    <ChevronLeft size={28} />
                </button>
            )}

            <div
                className="max-w-6xl max-h-full flex flex-col items-center gap-4"
                onClick={(event) => event.stopPropagation()}
            >
                <AuthenticatedImage
                    src={images[currentIndex]}
                    alt={`Preview ${currentIndex + 1}`}
                    className="max-w-full max-h-[80vh] h-auto w-auto"
                />
                {images.length > 1 && (
                    <p className="text-sm text-white/70">
                        {currentIndex + 1} / {images.length}
                    </p>
                )}
            </div>

            {images.length > 1 && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onNext();
                    }}
                    className="absolute right-5 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition"
                    aria-label="Next image"
                >
                    <ChevronRight size={28} />
                </button>
            )}
        </div>
    );
};

export default ImageLightbox;
