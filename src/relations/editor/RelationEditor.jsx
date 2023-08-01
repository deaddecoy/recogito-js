import React, { Component } from 'react';
import { TrashIcon, CheckIcon } from '@recogito/recogito-client-core';
import Autocomplete from '@recogito/recogito-client-core/src/editor/widgets/Autocomplete';
import { getWidget, DEFAULT_WIDGETS } from '@recogito/recogito-client-core/src/editor/widgets';
import i18n from '@recogito/recogito-client-core/src/i18n';
/**
 * Shorthand to get the label (= first tag body value) from the
 * annotation of a relation.
 */
const getContent = relation => {
  const firstTag = relation.annotation.bodies.find(b => b.purpose === 'tagging');
  return firstTag ? firstTag.value : '';
}

/** 
 * A React component for the relationship editor popup. Note that this
 * component is NOT wired into the RelationsLayer directly, but needs
 * to be used separately by the implementing application. We
 * still keep it in the /recogito-relations folder though, so that
 * all code that belongs together stays together.
 */
export default class RelationEditor extends Component {

  constructor(props) {
    super(props);
	this.element = React.createRef();
    this.state = {
      currentAnnotation: props.relation.annotation,
      dragged: false,
      // selectionBounds: bounds(props.selectedElement)
    }
  }

  componentDidMount() {
    this.setPosition();
  }

  componentDidUpdate() {
    this.setPosition();
  }

  /** Creator and created/modified timestamp metadata **/
  creationMeta = body => {
    const meta = {};

    const { user } = this.props.env;

    // Metadata is only added when a user is set, otherwise
    // the Editor operates in 'anonymous mode'.
    if (user) {
      meta.creator = {};
      if (user.id) meta.creator.id = user.id;
      if (user.displayName) meta.creator.name = user.displayName;

      meta[body.created ? 'modified' : 'created'] = this.props.env.getCurrentTimeAdjusted();
    }

    return meta;
  }
  
  getCurrentAnnotation = () =>
    this.state.currentAnnotation.clone();

  hasChanges = () =>
    !this.props.relation.annotation?.isEqual(this.state.currentAnnotation);

  /** Shorthand **/
  updateCurrentAnnotation = (diff, saveImmediately) => {
    this.setState({
      currentAnnotation: this.state.currentAnnotation.clone(diff)
    }, () => {
      if (saveImmediately)
        this.onOk();
      //else 
      //  this.props.onChanged && this.props.onChanged();
    })
  }
  setPosition() {
    if (this.element.current) {
      const el = this.element.current;
      const { midX, midY } = this.props.relation;

      el.style.top = `${midY}px`;
      el.style.left = `${midX}px`;
    }
  }
  
  onDelete = () =>
    this.props.onRelationDeleted(this.props.relation);


  onAppendBody = (body, saveImmediately) => {
	  return this.updateCurrentAnnotation({	  
    body: [
      ...this.state.currentAnnotation.bodies,
      { ...body, ...this.creationMeta(body) }
    ]
  }, saveImmediately);
  }
  
  onUpdateBody = (previous, updated, saveImmediately) => {
	  return this.updateCurrentAnnotation({
    body: this.state.currentAnnotation.bodies.map(body =>
      body === previous ? { ...updated, ...this.creationMeta(updated) } : body)
  }, saveImmediately);
  }
  
  onRemoveBody = (body, saveImmediately) => {	  
	  return this.updateCurrentAnnotation({ body: this.state.currentAnnotation.bodies.filter(b => b !== body)}, saveImmediately);
  }


   onUpsertBody = (arg1, arg2, saveImmediately) => {
    if (arg1 == null && arg2 != null) {
      // Append arg 2 as a new body
      this.onAppendBody(arg2, saveImmediately);
    } else if (arg1 != null && arg2 != null) {
      // Replace body arg1 with body arg2
      this.onUpdateBody(arg1, arg2, saveImmediately);
    } else if (arg1 != null && arg2 == null) {
      // Find the first body with the same purpose as arg1,
      // and upsert
      const existing = this.state.currentAnnotation.bodies.find(b => b.purpose === arg1.purpose);
      if (existing)
        this.onUpdateBody(existing, arg1, saveImmediately);
      else
        this.onAppendBody(arg1, saveImmediately);
    }
  }

  onBatchModify = (diffs, saveImmediately) => {
    // First, find previous bodies for auto upserts
    const autoUpserts = diffs
      .filter(d => d.action === 'upsert' && d.body)
      .map(d => ({
        previous: this.state.currentAnnotation.bodies.find(b => b.purpose === d.body.purpose),
        updated: { ...d.body, ...this.creationMeta(d.body)}
      }));

    const toRemove = diffs
      .filter(d => d.action === 'remove')
      .map(d => d.body);

    const toAppend = [
      ...diffs
        .filter(d => (d.action === 'append') || (d.action === 'upsert' && d.updated && !d.previous))
        .map(d => ({ ...d.body, ...this.creationMeta(d.body) })),

      ...autoUpserts
        .filter(d => !d.previous)
        .map(d => d.updated)
    ];

    const toUpdate = [
      ...diffs
        .filter(d => (d.action === 'update') || (d.action === 'upsert' && d.updated && d.previous))
        .map(d => ({
          previous: d.previous,
          updated: { ...d.updated, ...this.creationMeta(d.updated) }
        })),

      ...autoUpserts
        .filter(d => d.previous)
    ];

    const updatedBodies = [
      // Current bodies
      ...this.state.currentAnnotation.bodies
        // Remove
        .filter(b => !toRemove.includes(b))

        // Update
        .map(b => {
          const diff = toUpdate.find(t => t.previous === b);
          return diff ? diff.updated : b;
        }),

        // Append
        ...toAppend
    ]

    this.updateCurrentAnnotation({ body: updatedBodies }, saveImmediately);
  }

  onSetProperty = (property, value) => {
    // A list of properties the user is NOT allowed to set
    const isForbidden = [ '@context', 'id', 'type', 'body', 'target' ].includes(property);
    if (isForbidden)
      throw new Exception(`Cannot set ${property} - not allowed`);
    if (value) {
      this.updateCurrentAnnotation({ [ property ]: value });
    } else {
      const updated = this.currentAnnotation.clone();
      delete updated[ property ];
      this.setState({ currentAnnotation: updated });
    }
  }

  onAddContext = uri => {
    const { currentAnnotation } = this.state;
    const context = Array.isArray(currentAnnotation.context) ?
      currentAnnotation.context :  [ currentAnnotation.context ];
    if (context.indexOf(uri) < 0) {
      context.push(uri);
      this.updateCurrentAnnotation({ '@context': context });
    }
  }

  onCancel = () =>
    this.props.onCancel(this.props.relation);
	
  onDelete = () =>
    this.props.onRelationDeleted(this.props.relation);
	
  onOk = () => {
	  
	/*
	const undraft = annotation =>
      annotation.clone({
        body : annotation.bodies.map(({ draft, ...rest }) => rest)
    });
	*/  
	const { currentAnnotation } = this.state;			
	const updatedAnnotation = this.props.relation.annotation.clone({
      motivation: 'linking',
      body: currentAnnotation.body
    });
	const updatedRelation = { ...this.props.relation, annotation: updatedAnnotation };
	
	if (currentAnnotation.bodies.length === 0 && !this.props.allowEmpty) {
      if (updatedRelation.isSelection)
        this.onCancel();
      else
        this.props.onRelationDeleted(this.props.relation);
    } else {
      if (this.props.relation.annotation.bodies.length === 0) {
		this.props.onRelationCreated(updatedRelation, this.props.relation);
      } else {
        this.props.onRelationUpdated(updatedRelation, this.props.relation);
	  }
    }
  }
  
  render() {
	const { currentAnnotation } = this.state;
	
	const widgets = this.props.relationWidgets ?
		this.props.relationWidgets.map(getWidget) : DEFAULT_WIDGETS;
	
	const hasDelete = currentAnnotation &&
      // annotation has bodies or allowEmpty,
      (currentAnnotation.bodies.length > 0 || this.props.allowEmpty) && // AND
      !this.props.readOnly && // we are not in read-only mode AND
      !currentAnnotation.isSelection;
	  //&& // this is not a selection AND
      //!widgets.some(isReadOnlyWidget);  // every widget is deletable
	  
    return(
      <div className="r6o-relation-editor" ref={this.element}>
		<div className="r6o-editor-inner">
            {widgets.map((widget, idx) =>
              React.cloneElement(widget, {
                key: `${idx}`,
                focus: idx === 0,
				annotation : currentAnnotation,
                readOnly : this.props.readOnly,
                env: this.props.env,
                onAppendBody: this.onAppendBody,
                onUpdateBody: this.onUpdateBody,
                onRemoveBody: this.onRemoveBody,
                onUpsertBody: this.onUpsertBody,
                onBatchModify: this.onBatchModify,
                onSetProperty: this.onSetProperty,
                onAddContext: this.onAddContext,
                onSaveAndClose: this.onOk
              })
            )}
				<div className="r6o-footer">
                { hasDelete && (
                  <button
                    className="r6o-btn left delete-annotation"
                    title={i18n.t('Delete')}
                    onClick={this.onDelete}>
                    <TrashIcon width={12} />
                  </button>
                )}

                <button
                  className="r6o-btn outline"
                  onClick={this.onCancel}>{i18n.t('Cancel')}</button>

                <button
                  className="r6o-btn "
                  onClick={this.onOk}>{i18n.t('Ok')}</button>
              </div>
        </div>
      </div>
    )
  }

}