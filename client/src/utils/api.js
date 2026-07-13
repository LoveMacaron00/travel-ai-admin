import axios from 'axios';
import { appConfig } from '../config';

const api = axios.create({
    baseURL: appConfig.apiBaseUrl,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json'
    }
});

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('adminToken');

        if (token) {
            config.headers = config.headers || {};
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

api.interceptors.response.use(
    (response) => {
        return response;
    },
    (error) => {
        if (error.response) {
            console.error('API Error:', error.response.status, error.response.data);
            const hadSession = Boolean(localStorage.getItem('adminToken'));

            if (error.response.status === 401 && hadSession) {
                localStorage.removeItem('admin');
                localStorage.removeItem('adminToken');

                if (typeof window !== 'undefined') {
                    window.location.reload();
                }
            }
        } else if (error.request) {
            console.error('Network Error:', error.message);
        } else {
            console.error('Error:', error.message);
        }
        return Promise.reject(error);
    }
);

export default api;
