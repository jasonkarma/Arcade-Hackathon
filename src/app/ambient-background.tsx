"use client";

import { useEffect, useRef } from "react";

type Particle = {
    x: number;
    y: number;
    radius: number;
    opacity: number;
    speed: number;
    drift: number;
    phase: number;
    color: string;
};

type Wave = {
    color: string;
    center: number;
    amplitude: number;
    frequency: number;
    speed: number;
    phase: number;
    depth: number;
};

const PARTICLE_COLORS = ["245, 208, 169", "251, 191, 36", "217, 119, 6"] as const;

const WAVES: Wave[] = [
    { color: "rgba(59, 24, 45, 0.15)", center: 0.22, amplitude: 86, frequency: 0.0042, speed: 0.00016, phase: 0.2, depth: 210 },
    { color: "rgba(138, 74, 36, 0.15)", center: 0.42, amplitude: 112, frequency: 0.0032, speed: -0.00011, phase: 2.1, depth: 230 },
    { color: "rgba(59, 24, 45, 0.15)", center: 0.65, amplitude: 96, frequency: 0.0037, speed: 0.00013, phase: 4.4, depth: 220 },
    { color: "rgba(138, 74, 36, 0.15)", center: 0.82, amplitude: 72, frequency: 0.0046, speed: -0.00009, phase: 5.6, depth: 190 },
];

function createParticles(width: number, height: number, count: number): Particle[] {
    return Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 0.65 + Math.random() * 1.45,
        opacity: 0.18 + Math.random() * 0.48,
        speed: 0.08 + Math.random() * 0.18,
        drift: 0.08 + Math.random() * 0.22,
        phase: Math.random() * Math.PI * 2,
        color: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
    }));
}

/** Canvas-powered silk waves, sentiment dust, and a gently weighted cursor glow. */
export function AmbientBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const spotlightRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const spotlight = spotlightRef.current;
        if (!canvas || !spotlight) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let width = window.innerWidth;
        let height = window.innerHeight;
        let particles: Particle[] = [];
        let animationFrame = 0;
        let previousTime = performance.now();
        let targetX = width * 0.5;
        let targetY = height * 0.45;
        let cursorX = targetX;
        let cursorY = targetY;
        let pointerActive = false;

        const resize = () => {
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = Math.round(width * pixelRatio);
            canvas.height = Math.round(height * pixelRatio);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            particles = createParticles(width, height, width < 640 ? 42 : 50);
        };

        const movePointer = (event: PointerEvent) => {
            if (event.pointerType === "touch") return;
            targetX = event.clientX;
            targetY = event.clientY;
            pointerActive = true;
        };

        const leavePointer = () => {
            pointerActive = false;
            targetX = width * 0.5;
            targetY = height * 0.45;
        };

        const drawWave = (wave: Wave, time: number) => {
            const drift = Math.sin(time * wave.speed * 0.42 + wave.phase) * width * 0.08;
            const baseline = height * wave.center + Math.cos(time * wave.speed * 0.55 + wave.phase) * 42;

            context.beginPath();
            context.moveTo(-160, height + 180);
            for (let x = -160; x <= width + 160; x += 28) {
                const primary = Math.sin((x + drift) * wave.frequency + time * wave.speed + wave.phase);
                const secondary = Math.sin(x * wave.frequency * 0.47 - time * wave.speed * 0.7 + wave.phase * 1.7);
                context.lineTo(x, baseline + primary * wave.amplitude + secondary * wave.amplitude * 0.32);
            }
            context.lineTo(width + 160, height + wave.depth);
            context.lineTo(-160, height + wave.depth);
            context.closePath();
            context.fillStyle = wave.color;
            context.fill();
        };

        const draw = (time: number) => {
            const elapsed = Math.min(time - previousTime, 32);
            previousTime = time;
            const movementScale = reducedMotion ? 0 : elapsed / 16.67;

            cursorX += (targetX - cursorX) * 0.055;
            cursorY += (targetY - cursorY) * 0.055;
            spotlight.style.setProperty("--spotlight-x", `${cursorX}px`);
            spotlight.style.setProperty("--spotlight-y", `${cursorY}px`);
            spotlight.style.opacity = pointerActive ? "1" : "0.58";

            context.clearRect(0, 0, width, height);
            context.save();
            context.globalCompositeOperation = "screen";
            context.filter = "blur(58px)";
            for (const wave of WAVES) drawWave(wave, reducedMotion ? 2400 : time);
            context.restore();

            context.save();
            context.globalCompositeOperation = "lighter";
            for (const particle of particles) {
                particle.phase += 0.004 * movementScale;
                particle.y -= particle.speed * movementScale;
                particle.x += Math.sin(particle.phase) * particle.drift * movementScale;

                if (pointerActive) {
                    const dx = particle.x - cursorX;
                    const dy = particle.y - cursorY;
                    const distanceSquared = dx * dx + dy * dy;
                    const influenceRadius = 190;
                    if (distanceSquared > 1 && distanceSquared < influenceRadius * influenceRadius) {
                        const distance = Math.sqrt(distanceSquared);
                        const force = (1 - distance / influenceRadius) * 0.34 * movementScale;
                        particle.x += (dx / distance) * force;
                        particle.y += (dy / distance) * force * 0.65;
                    }
                }

                if (particle.y < -20) {
                    particle.y = height + 20;
                    particle.x = Math.random() * width;
                }
                if (particle.x < -20) particle.x = width + 20;
                if (particle.x > width + 20) particle.x = -20;

                const shimmer = 0.72 + Math.sin(particle.phase * 2.4) * 0.28;
                context.beginPath();
                context.fillStyle = `rgba(${particle.color}, ${particle.opacity * shimmer})`;
                context.shadowColor = `rgba(${particle.color}, 0.75)`;
                context.shadowBlur = 7 + particle.radius * 5;
                context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                context.fill();
            }
            context.restore();

            if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
        };

        resize();
        window.addEventListener("resize", resize);
        window.addEventListener("pointermove", movePointer, { passive: true });
        document.documentElement.addEventListener("pointerleave", leavePointer);
        animationFrame = requestAnimationFrame(draw);

        return () => {
            window.removeEventListener("resize", resize);
            window.removeEventListener("pointermove", movePointer);
            document.documentElement.removeEventListener("pointerleave", leavePointer);
            cancelAnimationFrame(animationFrame);
        };
    }, []);

    return (
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#09080b]" aria-hidden="true">
            <canvas ref={canvasRef} className="absolute inset-0 size-full opacity-90" />
            <div ref={spotlightRef} className="ambient-spotlight absolute inset-0 transition-opacity duration-700" />
            <div className="ambient-vignette absolute inset-0" />
            <div className="noise-grid absolute inset-0" />
        </div>
    );
}
