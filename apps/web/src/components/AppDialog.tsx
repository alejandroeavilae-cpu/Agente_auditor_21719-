// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

/**
 * Diálogo modal accesible (React Aria): atrapa el foco, se cierra con Escape, devuelve el foco
 * al botón que lo abrió y tiene título asociado. `role="alertdialog"` para confirmaciones
 * de acciones con consecuencias.
 */
export function AppDialog(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  alert?: boolean;
  /** Si es falso, ni Escape ni el clic afuera lo cierran (p. ej. mientras se muestra un enlace único). */
  isDismissable?: boolean;
}) {
  const dismissable = props.isDismissable ?? true;
  return (
    <ModalOverlay className="modal-overlay" isOpen={props.isOpen} onOpenChange={props.onOpenChange} isDismissable={dismissable} isKeyboardDismissDisabled={!dismissable}>
      <Modal className="modal">
        <Dialog className="dialog" role={props.alert === true ? 'alertdialog' : 'dialog'}>
          <Heading slot="title" className="dialog-title">
            {props.title}
          </Heading>
          {props.children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
