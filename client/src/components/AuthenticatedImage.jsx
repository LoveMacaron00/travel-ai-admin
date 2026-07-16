import { useEffect, useState } from 'react';
import { isPrivateUploadUrl, resolveAssetUrl } from '../config';

/**
 * โหลดรูป private ผ่าน fetch เพื่อแนบ Authorization header แล้วสร้าง blob URL
 * ชั่วคราวสำหรับ <img> รูปภายนอกใช้ URL เดิมและจะไม่ได้รับ admin token
 */
const useAuthenticatedImageUrl = (source) => {
    const [state, setState] = useState({ url: '', loading: Boolean(source), error: false });

    useEffect(() => {
        let cancelled = false;
        let objectUrl = null;
        const resolved = resolveAssetUrl(source);

        if (!resolved) {
            setState({ url: '', loading: false, error: false });
            return undefined;
        }
        if (!isPrivateUploadUrl(resolved)) {
            setState({ url: resolved, loading: false, error: false });
            return undefined;
        }

        const token = localStorage.getItem('adminToken');
        if (!token) {
            setState({ url: '', loading: false, error: true });
            return undefined;
        }

        setState({ url: '', loading: true, error: false });
        fetch(resolved, { headers: { Authorization: `Bearer ${token}` } })
            .then((response) => {
                if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
                return response.blob();
            })
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setState({ url: objectUrl, loading: false, error: false });
            })
            .catch(() => {
                if (!cancelled) setState({ url: '', loading: false, error: true });
            });

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [source]);

    return state;
};

const AuthenticatedImage = ({ src, alt = '', onError, ...props }) => {
    const { url, loading, error } = useAuthenticatedImageUrl(src);

    return (
        <img
            {...props}
            src={url || undefined}
            alt={alt}
            aria-busy={loading}
            data-image-error={error || undefined}
            onError={onError}
        />
    );
};

export { useAuthenticatedImageUrl };
export default AuthenticatedImage;
