"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { Ticket, TicketStatus } from '@/types';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from './AuthContext';

const TICKET_FILES_BUCKET = 'ticket-files';

interface TicketContextType {
  tickets: Ticket[];
  isLoadingTickets: boolean;
  error: string | null;
  addTicket: (ticketData: {
    name: string;
    phone: string;
    reason: string;
    estimated_response_time: string;
    observations?: string;
    file?: File;
  }) => Promise<void>;
  updateTicketStatus: (ticketId: string, status: TicketStatus) => Promise<void>;
  updateTicketResponsible: (ticketId: string, responsible: string) => Promise<void>;
  getTicketById: (ticketId: string) => Ticket | undefined;
  fetchTickets: () => void;
  downloadFile: (filePath: string, fileName: string) => Promise<void>;
  createPreviewUrl: (filePath: string) => Promise<string | null>;
}

const TicketContext = createContext<TicketContextType | undefined>(undefined);

export function TicketProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authIsLoading } = useAuth();

  const fetchTickets = useCallback(async () => {
    if (!isAuthenticated) {
        setIsLoadingTickets(false);
        setTickets([]);
        return;
    }
    
    setIsLoadingTickets(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('tickets')
        .select('*')
        .order('submission_date', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }
      setTickets(data || []);
    } catch (err: any) {
        const errorMessage = err.message || 'Ocorreu um erro desconhecido ao buscar os tickets.';
        setError(errorMessage);
        toast({ title: "Erro ao Carregar Tickets", description: errorMessage, variant: "destructive" });
        console.error("Error fetching tickets:", err);
    } finally {
      setIsLoadingTickets(false);
    }
  }, [isAuthenticated, toast]);

  useEffect(() => {
    if (!authIsLoading) {
        fetchTickets();
    }
  }, [authIsLoading, fetchTickets]);

  const addTicket = async (ticketData: {
    name: string;
    phone: string;
    reason: string;
    estimated_response_time: string;
    observations?: string;
    file?: File;
  }) => {
    
    let filePath: string | undefined = undefined;
    let fileName: string | undefined = undefined;

    try {
      if (ticketData.file) {
        const file = ticketData.file;
        fileName = file.name;
        const newFileName = `${crypto.randomUUID()}-${fileName}`;
        filePath = `public/${newFileName}`; 

        const { error: uploadError } = await supabase.storage
          .from(TICKET_FILES_BUCKET)
          .upload(filePath, file);

        if (uploadError) {
          throw new Error(`Erro no upload do arquivo: ${uploadError.message}`);
        }
      }

      const newTicketData = {
        name: ticketData.name,
        phone: ticketData.phone,
        reason: ticketData.reason,
        estimated_response_time: ticketData.estimated_response_time,
        observations: ticketData.observations,
        submission_date: new Date().toISOString(),
        status: "Novo" as TicketStatus,
        user_id: user?.id,
        file_path: filePath,
        file_name: fileName,
      };

      const { error: insertError } = await supabase.from('tickets').insert([newTicketData]);

      if (insertError) {
        throw new Error(`Erro ao salvar ticket: ${insertError.message}`);
      }

      toast({ title: "Ticket Criado", description: "Seu ticket foi registrado com sucesso." });
      if(isAuthenticated) await fetchTickets(); 

    } catch (error: any) {
      toast({ title: "Erro ao Criar Ticket", description: error.message || "Ocorreu um erro.", variant: "destructive" });
      console.error("Error adding ticket:", error);
    }
  };

  const updateTicketStatus = async (ticketId: string, status: TicketStatus) => {
    const { error } = await supabase
      .from('tickets')
      .update({ status })
      .eq('id', ticketId);

    if (error) {
      toast({ title: "Erro ao Atualizar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Status Atualizado", description: `Status do ticket alterado para ${status}.` });
      await fetchTickets();
    }
  };

  const updateTicketResponsible = async (ticketId: string, responsible: string) => {
    const { error } = await supabase
      .from('tickets')
      .update({ responsible })
      .eq('id', ticketId);

    if (error) {
      toast({ title: "Erro ao Atualizar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Responsável Atualizado", description: `Responsável pelo ticket alterado para ${responsible}.` });
      await fetchTickets();
    }
  };

  const getTicketById = (ticketId: string): Ticket | undefined => {
    return tickets.find(ticket => ticket.id === ticketId);
  };
  
  const downloadFile = async (filePath: string, fileName: string) => {
    try {
      const { data, error } = await supabase.storage.from(TICKET_FILES_BUCKET).download(filePath);
      if (error) throw error;
      
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: "Download Iniciado", description: `Baixando ${fileName}...` });
    } catch (error: any) {
        toast({ title: "Erro no Download", description: `Não foi possível baixar o arquivo: ${error.message || "Erro desconhecido."}`, variant: "destructive" });
        console.error("Error downloading file:", error);
    }
  };

  const createPreviewUrl = async (filePath: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from(TICKET_FILES_BUCKET)
        .createSignedUrl(filePath, 60); // Link válido por 60 segundos

      if (error) {
        throw error;
      }
      return data.signedUrl;
    } catch (error: any) {
      console.error("Error creating signed URL:", error);
      toast({
        title: "Erro ao Gerar Link",
        description: `Não foi possível criar o link de visualização: ${error.message}`,
        variant: "destructive",
      });
      return null;
    }
  };

  return (
    <TicketContext.Provider value={{ 
        tickets, 
        isLoadingTickets,
        error, 
        addTicket, 
        updateTicketStatus, 
        updateTicketResponsible, 
        getTicketById, 
        fetchTickets, 
        downloadFile,
        createPreviewUrl
    }}>
      {children}
    </TicketContext.Provider>
  );
}

export function useTickets() {
  const context = useContext(TicketContext);
  if (context === undefined) {
    throw new Error('useTickets must be used within a TicketProvider');
  }
  return context;
}
