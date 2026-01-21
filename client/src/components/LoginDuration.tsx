import React, { useState, useEffect } from 'react';
import { t } from '../utils/i18n';

interface LoginDurationProps {
    startTime: string;
}

export const LoginDuration: React.FC<LoginDurationProps> = ({ startTime }) => {
    const [duration, setDuration] = useState({ days: 0, hours: 0, minutes: 0 });

    useEffect(() => {
        const calculate = () => {
            const start = new Date(startTime).getTime();
            const now = new Date().getTime();
            const diff = Math.max(0, now - start);

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

            setDuration({ days, hours, minutes });
        };

        calculate();
        const timer = setInterval(calculate, 60000); // Update every minute
        return () => clearInterval(timer);
    }, [startTime]);

    return (
        <div className="text-sm text-gray-500 flex items-center justify-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            {t.loginDuration}: {t.durationFormat
                .replace('{days}', duration.days.toString())
                .replace('{hours}', duration.hours.toString())
                .replace('{minutes}', duration.minutes.toString())
            }
        </div>
    );
};
