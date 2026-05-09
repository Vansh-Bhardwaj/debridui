"use client";

import { useState, useEffect, createContext, useContext } from "react";
import { SearchDialog } from "./search-dialog";

interface SearchContextType {
    open: boolean;
    setOpen: (open: boolean) => void;
    toggle: () => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function useSearch() {
    const context = useContext(SearchContext);
    if (!context) {
        throw new Error("useSearch must be used within a SearchProvider");
    }
    return context;
}

interface SearchProviderProps {
    children: React.ReactNode;
}

export function SearchProvider({ children }: SearchProviderProps) {
    const [open, setOpen] = useState(false);

    const toggle = () => setOpen((prev) => !prev);

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            // Cmd/Ctrl+K from anywhere
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                toggle();
                return;
            }
            // "/" opens search when not typing into a field
            if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const target = e.target as HTMLElement | null;
                if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
                e.preventDefault();
                setOpen(true);
            }
        };

        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    return (
        <SearchContext.Provider value={{ open, setOpen, toggle }}>
            {children}
            <SearchDialog open={open} onOpenChange={setOpen} />
        </SearchContext.Provider>
    );
}
